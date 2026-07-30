export const meta = {
  name: 'round2h-lifecycle-lineage-risk',
  description: 'Pips become finite: per-pip leveling, lifespan, ailments with countdowns, true loss with lineage-recovery eggs, breeding unfenced',
  phases: [
    { title: 'Design', detail: 'lifecycle bible — the numbers, the five promises made mechanical' },
    { title: 'Core', detail: 'pip levels, then lifecycle/ailments, then breeding + lineage eggs' },
    { title: 'Content', detail: 'ailments, cures, healing buildings, biome danger' },
    { title: 'UI', detail: 'pip level + ailment surfaces; memorial/lineage + breeding' },
    { title: 'Integrate', detail: 'wire, layering, full suite green' },
    { title: 'Verify', detail: 'gate + cruelty audit + mutation' },
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

const CONTEXT = `Project: /Users/gary/dev/pipskeep (2189 tests green, HEAD 47760cf). Read CLAUDE.md, then PIPSKEEP_SPEC.md — **especially §16's v1.5 amendment, which is THE brief for this round** — plus §4.4, §4.6, §7, §12, §15.5. Then docs/progression-bible.md and docs/retention-bible.md.

THE PIVOT: the project owner has reversed the game's oldest hard rule. Pips were immortal; now they are finite, "almost like chickens or cattle — some might last a long time, but they don't last forever". The owner's stated fear, in their words: it "can't be brutal that a player loses their star too quickly and are disappointed".

Spec §16 v1.5 makes this concrete. THE FIVE PROMISES are hard rules, not tuning values, and every one must be mechanically enforced and TESTED:
1. **Loss is never a surprise.** A Pip never simply fails to return from an expedition. Danger arrives as an AILMENT with a visible countdown and a real, actionable chance to save them.
2. **Loss is never caused by absence.** Ailment progression obeys the SAME offline rate cap as needs (§4.5, currently 16h). A player away for a week must never return to a Pip who died because they were away. This preserves round 2C's guardrail.
3. **Old age is peaceful.** A Pip reaching the end of a full life RETIRES to the Long Meadow (round 2C's sanctuary) — still named, visitable, in the Album, never deleted. Only danger can truly take a Pip.
4. **Every loss leaves a thread to pull.** A Pip lost to an ailment LEAVES AN EGG in the biome that took them, findable on later expeditions there, carrying their lineage.
5. **The Keep is never empty.** At least one Pip always remains active. A player can never return to an unplayable Keep.

ALSO IN SCOPE:
- PER-PIP LEVELING, separate from Keep XP (which round 2F built). A Pip's own levels improve THAT PIP: slower need decay, faster expeditions, better ailment resilience. This is the owner's answer to "no individual Pip matters long-term — nothing develops past 72 hours".
- LIFESPAN: roughly 1-2 weeks of active play for a well-cared Pip, extendable by care quality, level and buildings.
- BREEDING IS UNFENCED (§12 amended). \`combineGenomes()\` in core/pips/genome.ts has been implemented and unit-tested since Phase 4 and called by NOTHING, reserved for exactly this. It goes live as the succession mechanic: descendants inherit traits and a share of earned levels.
- THE ALBUM IS PERMANENT: a lost or retired Pip keeps its page forever; collection progress can never regress.

EXISTING GUARDS THAT STILL BIND: core/pips/balance.test.ts, core/keep/effects.balance.test.ts, core/economy/reachability.test.ts, src/ui/layers.test.ts. Per-pip level effects are a NEW multiplicative factor on decay — they must be capped so a veteran Pip shortens the care CHORE without trivializing care, exactly as 2F's building comfort effects were (comfortReductionMax 0.25 is that round's fragile invariant — read effects.balance.test.ts before choosing your cap).

ARCHITECTURE: core/ pure (no Date.now outside clock.ts, no Math.random outside rng.ts, no pixi/DOM); tuning in content/tuning.ts; time via action 'at' timestamps; rng cursors in GameState; ONE save-schema bump for the whole round with migration + fixture. Existing saves must migrate so that no currently-owned Pip is instantly old or ailing — a veteran player must not be punished for having played. npm test + npm run build green. Do not commit. Do not touch PROGRESS.md or .claude/. Do not hand-edit another agent's files.

NOTE: round 2G (HUD legibility) may be running concurrently against ui/topBar.ts, xpBar.ts, levelUp.ts, milestoneCelebration.ts, awaySheet.ts, dailies.ts, lootReveal.ts, buildSheet.ts, buildMode.ts. AVOID EDITING THOSE FILES. If this round needs a surface in one of them, define the seam and report it for the orchestrator to wire.`

phase('Design')
const design = await agent(`${CONTEXT}

You are the lifecycle designer. Write THE LIFECYCLE BIBLE to /Users/gary/dev/pipskeep/docs/lifecycle-bible.md. Design only — no feature code. You MAY add a commented \`tuning.lifecycle\` block to src/content/tuning.ts (numbers only; leave every existing value byte-identical).

Read the code you are designing onto FIRST: core/pips/{types,needs,lifecycle,machine,catchup,genome}.ts, core/state.ts, core/sanctuary/, core/expeditions/, core/progression/xp.ts, core/keep/effects.ts, and the four guard suites named above.

DESIGN, each with data shape, numbers, and a "how the player experiences this" line:

1. **PER-PIP LEVELS.** What earns a Pip XP (its own actions: being cared for, completing expeditions, working jobs). The curve. What each level improves — decay resistance, expedition speed, ailment resilience — with a HARD CAP, and the arithmetic proving a max-level Pip still needs daily care (run it against balance.test.ts's leave-safe-floor method and show the worst case).
2. **LIFESPAN.** How age accrues, target ~1-2 weeks of active play, and what extends it (care quality, level, buildings). Does age accrue while the player is away? Reason about promise 2 and promise 5 together: if aging runs in real time, a 3-week absence retires the whole roster and the player returns to an empty Keep. Solve that explicitly — state the rule and its arithmetic.
3. **AILMENTS.** The state machine (contracted → countdown → cured | lost). Which biomes can inflict them and at what odds; how the countdown is expressed to the player in TIME they understand; what cures them (care actions, items, a healing building) and the cure's success odds; whether a cured Pip carries anything forward (a scar, a trait, resistance). The countdown MUST obey the §4.5 offline cap — state exactly how.
4. **THE LOSS MOMENT.** What the player sees. This is the most emotionally loaded surface in the game and it must be dignified, not gamey — no failure buzzer, no red X. Write the actual copy.
5. **LINEAGE EGGS.** A lost Pip leaves an egg in the biome that took them. Find odds (generous — the owner wants recovery to feel reachable, not a rare drip), how many expeditions it typically takes, what the hatchling inherits (traits + share of levels), and how the player LEARNS the egg is out there (they must know to go looking).
6. **BREEDING.** Two Pips → an egg via the existing \`combineGenomes(a, b, rng)\`. Eligibility (age, level, bond?), cooldowns, what is inherited, and how it composes with lineage eggs without making the Album trivial to complete.
7. **THE ANTI-BRUTALITY SYSTEM.** The owner's explicit fear. Specify: how the STARTER Pip is protected in week 1; how a player is warned BEFORE sending a Pip somewhere that can hurt it; whether risk is opt-in (a safe route and a risky route to the same biome?); grace for a first loss; and how the game makes a loss feel like a story rather than a punishment. If any mechanic cannot be made non-brutal, say so and cut it.
8. **THE FIVE PROMISES AS TESTS.** For each promise, write the exact test that would prove it holds. These become the round's gate.
9. Risks, interactions with every 2A-2G system, and the save-schema change.

Be decisive and specific — builders implement exactly what you write.`, { label: 'design:lifecycle-bible', phase: 'Design', schema: REPORT })

phase('Core')
const c1 = await agent(`${CONTEXT}

Read /Users/gary/dev/pipskeep/docs/lifecycle-bible.md and implement PER-PIP LEVELS + LIFESPAN/AGING. Designer: ${JSON.stringify(design?.summary ?? 'read the bible')}

You own src/core/pips/level.ts (new), aging in src/core/pips/lifecycle.ts, and the PipState/state/save changes they need. Do NOT touch ailments or breeding (peer agents).

1. Per-pip XP + levels: award sources per the bible, applied at ONE call site (follow 2C's touchProgressionVisit / 2F's applyKeepXpForAction boundary so no reducer arm can forget it and no isolated unit test silently gains XP).
2. Level effects as a NEW capped multiplicative factor in the decay/expedition paths. Compose with 2F's building comfort effects WITHOUT breaking effects.balance.test.ts — read it first; if the composed floor breaks it, the cap is wrong.
3. Aging + retirement-by-old-age → the Long Meadow, reusing core/sanctuary's retire path (do not duplicate it). PROMISE 5: the last active Pip can never auto-retire — enforce structurally, and test it.
4. PROMISE 2 for aging: implement the bible's rule for offline aging so a long absence cannot empty the Keep. Test a 3-week absence explicitly.
5. Migration: existing Pips must NOT arrive instantly old. Give them a sane age/level derived from what they have already done, and test that a veteran save is not punished.
6. Tests: level awards loop the source table; effect caps hold at max stacking; a max-level Pip still needs daily care (the arithmetic test); aging to retirement; last-Pip protection; the 3-week-absence test; migration.`, { label: 'core:levels-aging', phase: 'Core', schema: REPORT, model: 'sonnet' })

const c2 = await agent(`${CONTEXT}

Read /Users/gary/dev/pipskeep/docs/lifecycle-bible.md and implement AILMENTS + THE LOSS PATH. Peer c1 built levels/aging (${JSON.stringify(c1?.summary ?? 'read core/pips/level.ts')}) — read it, do not edit it.

You own src/core/pips/ailment.ts (new) and its state/reducer/save wiring. Do NOT edit level.ts, lifecycle.ts's aging, or breeding.

1. The ailment state machine per the bible: contraction on risky expedition returns (seeded RNG, cursor in GameState), a countdown, cure attempts, and resolution to cured or lost.
2. **PROMISE 1 — never a surprise.** There must be NO code path that removes a Pip on expedition return. Loss happens ONLY at the end of a countdown the player could see. Write a test that proves no expedition-return path can remove a Pip.
3. **PROMISE 2 — never caused by absence.** Countdown progression obeys the §4.5 offline rate cap exactly as needs do; integrate through core/pips/catchup.ts's existing segmented pass and its extraEvents seam rather than inventing a parallel timer. TEST: a Pip contracts an ailment, the player is away 7 days, and the Pip is NOT lost — the countdown advanced by at most the cap.
4. **PROMISE 4 — a thread to pull.** On loss, record a lineage-egg claim against the biome that took them (the breeding agent consumes it; define the shape and report it clearly).
5. **PROMISE 5** — a loss may never empty the Keep: if the ailing Pip is the last active one, it cannot be lost. Enforce structurally and test it.
6. **THE ALBUM IS PERMANENT** — a lost Pip's Album entry must survive. Test it.
7. Tests: contraction odds deterministic from the seeded stream; countdown exactness under FakeClock; cures; the four promise-tests above; and a test that a cured Pip is genuinely fine.`, { label: 'core:ailments-loss', phase: 'Core', schema: REPORT, model: 'sonnet' })

const c3 = await agent(`${CONTEXT}

Read /Users/gary/dev/pipskeep/docs/lifecycle-bible.md and implement BREEDING + LINEAGE EGGS. Peers built levels/aging (${JSON.stringify(c1?.summary ?? 'read core/pips/level.ts')}) and ailments/loss (${JSON.stringify(c2?.summary ?? 'read core/pips/ailment.ts')}) — read both, edit neither.

You own src/core/pips/breeding.ts (new) and the lineage-egg wiring into core/eggs + core/expeditions.

1. **UNFENCE combineGenomes().** It is implemented and tested in core/pips/genome.ts and called by nothing — this is its moment (spec §12 amended by §16 v1.5). Wire it as the succession mechanic per the bible: eligibility, cooldowns, inheritance of traits AND a share of earned levels.
2. **LINEAGE EGGS (promise 4).** Consume the claim c2 records on loss: the biome that took a Pip can later yield that Pip's egg. Odds per the bible — generous, because the owner wants recovery reachable, not a rare drip. The hatchling carries the lost Pip's lineage (traits + share of levels). Deterministic from the seeded expedition/egg streams; cursor contract preserved.
3. The player must be able to LEARN a lineage egg is out there — expose the pending claims in state so the UI can say "something of theirs remains in the Snowdrift". Define the seam and report it.
4. Do not let this trivialize the Album: reason about and test the interaction with 2C's pity counter and 2B's biome egg pools.
5. Tests: combineGenomes wired and inheritance correct (traits + level share); lineage-egg odds deterministic and reachable within the bible's expected number of trips (a simulation test); pity/pool interactions; a lost Pip's line genuinely recoverable end to end (lose → expedition → egg → hatch → the descendant carries the lineage).`, { label: 'core:breeding-lineage', phase: 'Core', schema: REPORT, model: 'sonnet' })

phase('Content')
const content = await agent(`${CONTEXT}

Read docs/lifecycle-bible.md. Core is built: levels/aging (${JSON.stringify(c1?.summary ?? '')}), ailments (${JSON.stringify(c2?.summary ?? '')}), breeding/lineage (${JSON.stringify(c3?.summary ?? '')}).

You own src/content/: ailments.ts (new), biome danger flags on expeditions.ts, cure items in foods.ts, a healing building in placeables.ts, lifecycle numbers in tuning.ts, and validate.ts extensions. Do NOT touch core/ or ui/.

1. Author the ailments: names, flavor, countdown lengths, cure methods and odds, per-biome incidence. Tone (§15.5): an ailing Pip is a worry, not a horror — warm, never grim. Names should be cozy-world ("frostnip", "bramble-fret") rather than clinical.
2. Biome danger: which of the 6 biomes can inflict ailments and how risky each is. The first two biomes must be SAFE — the anti-brutality rule.
3. Cures: at least one craftable/findable item and one healing building (with its build cost, reachability-safe).
4. Lifecycle tuning numbers per the bible.
5. validate.ts must catch: an ailment with no cure, a biome flagged dangerous with no ailment pool, a cure item that does not exist, a countdown shorter than the offline cap (which would break promise 2 by construction). Test each.
6. reachability.test.ts and balance.test.ts must stay green.`, { label: 'content:ailments-cures', phase: 'Content', schema: REPORT, model: 'sonnet' })

phase('UI')
const ui = await agent(`${CONTEXT}

Read docs/lifecycle-bible.md. Core + content are built.

You own NEW ui modules only: src/ui/pipLevel.ts, src/ui/ailment.ts, src/ui/memorial.ts, src/ui/breeding.ts and their own CSS file. **Do NOT edit topBar.ts, xpBar.ts, levelUp.ts, milestoneCelebration.ts, awaySheet.ts, dailies.ts, lootReveal.ts, buildSheet.ts, buildMode.ts, focusView.ts** — round 2G may be editing several of those concurrently. Export init/open functions; the integrator mounts them and wires any seam you need in a file you do not own. List every seam you need in your report.

1. **PIP LEVEL**: a Pip's own level and progress, and what its next level improves. Must read as "this Pip is growing", the answer to "no individual Pip matters".
2. **AILMENT (promise 1)**: an unmissable but WARM warning surface — which Pip, what they have, how long you have in human time, and exactly what you can do about it. Never a red-alert klaxon; this is a worried pet, not a fire.
3. **RISK WARNING**: before sending a Pip to a dangerous biome, the player must understand the risk. Design the confirm; it must inform without nagging on every send.
4. **THE LOSS MOMENT + MEMORIAL**: dignified, quiet, unhurried. Use the bible's copy. Then the lineage thread — tell the player something of theirs remains in that biome, so loss points somewhere.
5. **BREEDING**: pick two eligible Pips, see what a pairing might pass on, produce an egg. Warm and simple; it is a hopeful screen.
6. Pure controllers + dumb DOM; unit-test the models. Register every new surface in src/ui/layers.test.ts's ladder — this project has a recurring stacking-context hazard. Verify visually at 375px and desktop. Report what you saw.`, { label: 'ui:lifecycle-surfaces', phase: 'UI', schema: REPORT, model: 'sonnet' })

phase('Integrate')
const integ = await agent(`${CONTEXT}

Builders finished. bible: ${JSON.stringify(design?.summary ?? 'missing')} | levels/aging: ${JSON.stringify(c1?.summary ?? 'missing')} | ailments: ${JSON.stringify(c2?.summary ?? 'missing')} | breeding/lineage: ${JSON.stringify(c3?.summary ?? 'missing')} | content: ${JSON.stringify(content?.summary ?? 'missing')} | ui: ${JSON.stringify(ui?.summary ?? 'missing')}

1. ONE save-schema bump for the round, with migration + fixture. A veteran save must migrate so no Pip is instantly old or ailing — test it.
2. Mount every new surface and wire every seam the UI agent listed. If a seam needs a file round 2G owns, make the SMALLEST possible edit and flag it prominently so the orchestrator can check for conflicts.
3. **THE PROMISE TABLE** — the round's headline deliverable. For each of the five promises: the mechanism that enforces it, and the named test that proves it. Any promise without both is a blocker finding.
4. **THE VISIBILITY TABLE** — this codebase has shipped FIVE dead features. Every new mechanic: where core applies it → where the player sees it. Empty second column = finding.
5. Full npm test + npm run build green; balance.test.ts, effects.balance.test.ts, reachability.test.ts, layers.test.ts all pass.
6. Browser smoke at 375px (restart the dev server; port 5317 pinned): raise a Pip's level and see it; send a Pip somewhere dangerous and see the warning; use the debug time slider to bring on an ailment and watch the countdown; cure one; let one lapse and see the loss + memorial + lineage thread; find a lineage egg; breed two Pips. Report REAL observations.`, { label: 'integrate', phase: 'Integrate', schema: REPORT })

phase('Verify')
const [gate, cruelty, mutation] = await parallel([
  () => agent(`Gate runner for /Users/gary/dev/pipskeep round 2H. Run npm test + npm run build YOURSELF. THE FIVE PROMISES ARE THE GATE — for each, quote the named test that proves it: (1) no expedition-return path can remove a Pip (loss only via a visible countdown); (2) a 7-day absence cannot lose an ailing Pip — countdown obeys the §4.5 offline cap; (3) old age retires to the Long Meadow, never deletes, and the Pip stays visitable + in the Album; (4) a lost Pip leaves a recoverable lineage egg, proven end to end (lose → expedition → egg → hatch → descendant carries the lineage); (5) the Keep can never be emptied — last-Pip protection against BOTH aging and ailment. Then: per-pip level effects capped, and a max-level Pip in a max-built Keep STILL needs daily care (quote the arithmetic test); combineGenomes is now actually called by gameplay (grep — it was dead since Phase 4); a veteran save migrates without instant age or ailment; all four guard suites pass. pass=true only on evidence you gathered yourself.`, { label: 'gate-runner', phase: 'Verify', schema: FINDINGS }),
  () => agent(`CRUELTY AUDIT for /Users/gary/dev/pipskeep round 2H. The owner reversed the game's oldest rule to add stakes, but was explicit that it "can't be brutal that a player loses their star too quickly and are disappointed". You decide whether this round respects that.

Read PIPSKEEP_SPEC.md §16 v1.5's five promises and docs/lifecycle-bible.md, then PLAY IT. Dev server on 5317 (kill stale vite first); use the debug time slider, grants and crafted saves to reach the states you need.

Answer with specifics and real numbers:
(a) Simulate a NEW player's first week. Can they lose their starter? How easily? Is the early game protected as the bible claims?
(b) Send a Pip to the most dangerous biome. Were you warned clearly BEFORE committing? Could a player do this without understanding the risk?
(c) Contract an ailment. Is the countdown legible in human time? Is the cure discoverable without documentation? Measure how long you actually have.
(d) Let a Pip lapse. Is the loss dignified or gamey? Quote the copy. Does it point you at the lineage egg, and would a player understand something is recoverable?
(e) Go find the lineage egg. How many expeditions did it take? Is that reachable or a grind?
(f) Simulate closing the app for 7 days with an ailing Pip. Did they survive? (If not, that is a BLOCKER — promise 2.)
(g) Simulate 3 weeks away. Is the Keep still playable? (Empty Keep = BLOCKER — promise 5.)
(h) Overall: does mortality make this game better and more meaningful, or does it just make it stressful? Be blunt. Would YOU keep playing after losing a favourite?
Findings for anything that could disappoint a player unfairly, any surprise loss, any unclear risk, any unreachable recovery. pass=false if any of the five promises is breakable in play.`, { label: 'audit:cruelty', phase: 'Verify', schema: FINDINGS }),
  () => agent(`Mutation tester for /Users/gary/dev/pipskeep round 2H. Work is UNCOMMITTED — copy targets to the session scratchpad, restore + cmp after EACH cycle, NEVER git-restore. Mutations vs src (never tests): (1) an expedition return can remove a Pip directly (promise 1 broken); (2) ailment countdown ignores the offline cap (promise 2 broken — a week away kills); (3) old age deletes instead of retiring to the Long Meadow (promise 3); (4) a lost Pip records no lineage claim (promise 4 — loss becomes a dead end); (5) lineage-egg odds set to ~0 (recovery unreachable); (6) last-Pip protection removed for ailments (promise 5 — Keep can empty); (7) last-Pip protection removed for aging (promise 5); (8) a lost Pip's Album entry is deleted (collection regresses); (9) per-pip level decay cap removed (a veteran Pip stops needing care); (10) level effects computed but never consulted by decay (the dead-feature class, six-time offender); (11) combineGenomes returns one parent's genome unchanged (inheritance is fake); (12) the migration marks existing Pips as old (veterans punished). For each: apply, npm test, record FAILED (good, name the catching test) or SURVIVED (major + the missing assertion). Mutations 1/2/6/7 are promise-breakers and a survivor there is a BLOCKER, not a major — they are the difference between stakes and cruelty. Finish suite green, git status only legitimate round-2H files.`, { label: 'audit:mutation', phase: 'Verify', schema: FINDINGS }),
])

const all = [gate, cruelty, mutation].filter(Boolean)
const majors = all.flatMap(r => r.findings).filter(f => f.severity !== 'minor')
const minors = all.flatMap(r => r.findings).filter(f => f.severity === 'minor')

phase('Fix')
let fixReport = null
let regate = null
if (majors.length > 0) {
  fixReport = await agent(`${CONTEXT}

Fix these round-2H findings (blockers and majors mandatory, minors if cheap): ${JSON.stringify(majors)} Minors: ${JSON.stringify(minors)}. A broken PROMISE is the most serious class of defect in this round — it is the difference between stakes and cruelty, and the owner's one stated fear. Cruelty-audit findings rank equal to correctness: if a mechanic can disappoint a player unfairly, change the DESIGN (protect the early game further, lengthen the countdown, raise the lineage-egg odds), not the test. End green: npm test + npm run build.`, { label: 'fixer', phase: 'Fix', schema: REPORT })
  regate = await agent(`In /Users/gary/dev/pipskeep: npm test + npm run build, and re-run and NAME balance.test.ts, effects.balance.test.ts, reachability.test.ts, layers.test.ts, plus every test that proves one of the five promises. Report real output. pass=true only if fully green.`, { label: 're-gate', phase: 'Fix', schema: FINDINGS })
} else {
  log('No blocker/major findings — round 2H verified clean')
}

return {
  bible: design?.summary,
  levelsAging: c1?.summary,
  ailments: c2?.summary,
  breeding: c3?.summary,
  content: content?.summary,
  ui: ui?.summary,
  integration: integ?.summary,
  crueltyVerdict: cruelty?.notes,
  decisions: [design, c1, c2, c3, content, ui, integ].filter(Boolean).flatMap(x => x.decisions ?? []),
  gatePass: (regate ?? gate)?.pass ?? false,
  majorsFixed: majors,
  minorsOutstanding: minors,
  fixReport: fixReport?.summary ?? null,
}