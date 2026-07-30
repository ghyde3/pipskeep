export const meta = {
  name: 'round2g-legible-progression',
  description: 'Oracle visual pass on the game HUD, then build: XP bar prominence, Doorstep progression report, celebration collisions, set bonuses stated, inert chip',
  phases: [
    { title: 'Oracle', detail: 'fable visual pass on the running game — critique + concrete redesign' },
    { title: 'Build', detail: 'sonnet builds the HUD; a peer surfaces the invisible progression' },
    { title: 'Integrate', detail: 'wire, layering, full suite green' },
    { title: 'Verify', detail: 'gate + fresh-eyes legibility audit + mutation' },
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

const CONTEXT = `Project: /Users/gary/dev/pipskeep (2189 tests green, HEAD 47760cf). Read CLAUDE.md, PIPSKEEP_SPEC.md §10 + §16's changelog, docs/progression-bible.md, docs/retention-bible.md.

THE STATE OF THE GAME: rounds 2A-2F built a genuinely deep game — 14 species forms, 6 biomes, a 12-tier Keep ladder, Keep XP from 35 sources, building effects with themed set bonuses, 45 build items, an Album, a sanctuary, streaks, bounties, mastery, pity, events. Round 2F's own game-design audit delivered the verdict this round exists to fix:

  "The spine exists and is real; the surfaces that would let a player FEEL it are half-built."

THE OWNER'S BRIEF, in their words: "The top UI with the pips and status bar is clunky for a game - this needs a strong revision pass to update." They explicitly instructed: an ORACLE sub-agent does a visual pass and proposes, THEN a Sonnet agent builds it. The owner sanctioned the expensive fable model for that visual pass specifically.

THE MEASURED FAILURES 2F's audit left open (these are your work-list, all reproduced on a 375x812 viewport):
1. BLOCKER — The day-2 Doorstep reports ONLY decay. It never mentions Keep XP earned while away, what a staffed station produced, or that a Keep tier is READY to purchase. The single most important return moment in the game does not sell the progression at all.
2. XP is granted at ~15 kinds of moment and displayed at 5. The LOOT REVEAL — the richest source, and the bible's designated "dopamine core" — shows no XP whatsoever.
3. The XP bar's fill track is 56 px wide on a 375 px screen — 16% of its own 351 px widget, the smallest bar on screen. The round's headline feature is its least visible element.
4. Set bonuses are never stated anywhere. The build sheet says "Meadow Green — 0 of 7 placed" and later "· bonus active", but NEVER what the bonus actually is.
5. The tier-up banner and the milestone ribbon both anchor at top:0 over a ~200px top bar; their text collides with the need bars and the roster strip, and both become unreadable.
6. The gold pulsing "Lv N ▸ Ready" chip is INERT — the bar is a role=status div with no click handler — while the real tap target is a second, separate Keep-level chip elsewhere.
7. The XP bar advertises tier 7 as "+2 rows of ground" and tier 9 as "+2 columns of ground" — foreshadowing the least exciting thing each tier does, when the bar's only job is to name the carrot.
8. Bar numerals exceed 100% of a tier while it sits Ready ("460 / 300", "850 / 700") — reads as a bug, not as banked progress.
9. 45 cards make the Build sheet 13 screens of scroll on mobile, with the same two lines on almost every card and no cost shown on locked cards.
10. Every visibilitychange dispatches CATCHUP, so a 3-minute absence re-gates the session behind the full Doorstep modal and closes whatever sheet was open.

CONSTRAINTS: mobile-first 375px AND desktop. Keep the accessibility labels added in Phase 6. Pure-controller + dumb-DOM pattern. No new dependencies. src/ui/layers.test.ts pins the z-index ladder — this project has a KNOWN stacking-context trap (.pk-phase5's keep bar cannot be z-index'd under sheets and must be HIDDEN instead, see buildSheet.ts's onOpenChange); do not reintroduce it. npm test + npm run build green before finishing. Do not commit. Do not touch PROGRESS.md or .claude/.`

phase('Oracle')
const oracle = await agent(`${CONTEXT}

You are the ORACLE doing the visual pass the project owner explicitly asked for. Do NOT write feature code. Produce a design document at /Users/gary/dev/pipskeep/docs/hud-redesign.md.

GO LOOK AT THE RUNNING GAME FIRST. Start the dev server (port 5317 is pinned, autoPort:false is deliberate — kill any stale vite first). Use the debug menu (backquote or the wrench) — its time slider, grants, Spawn egg — and craft IndexedDB saves if you need a high-level or many-pip state. Screenshot and inspect at 375x812 AND desktop. Look at: the top bar with 1 pip and with 5, a pip on expedition, a sulking pip, low needs, the XP bar mid-gain and at Ready, the tier-up banner, the milestone ribbon, the Doorstep on a day-2 return, the build sheet with 45 items.

Then critique it AS A GAME HUD, not as a web-app header. The current top bar is a stacked dashboard: a roster strip, then a name row, then a 2x2 grid of four labelled need bars with numerals, then a wrapping row of resource chips, then the XP bar — roughly 200px of chrome on an 812px screen, and the most-looked-at surface in the game is its weakest.

Your document must contain:
1. A HONEST CRITIQUE with specifics and measurements — what is wrong, why it reads as clunky, what a player's eye actually does when it lands on this screen.
2. A CONCRETE REDESIGN. Not adjectives — a specification. Exact layout, hierarchy, sizes, what collapses or hides, what is always visible versus on-demand. Reason about the information budget: needs (4 values x up to 5 pips), resources (9+ item types), XP + tier, streak, and pending attention (reveals, ready tiers, pipping eggs) all want the same strip. Decide what EARNS permanent space and what does not. Address the 200px chrome problem directly.
3. Where the XP bar lives and how it becomes prominent rather than the smallest bar on screen (failure 3), including how it names the NEXT CARROT well (failure 7) and how it shows banked over-100% progress honestly (failure 8).
4. How the celebration surfaces (tier-up banner, milestone ribbon) coexist with the top bar without collision (failure 5), and where the Ready affordance lives so it is the actual tap target (failure 6).
5. A per-failure mapping: for each of the 10 numbered failures above, the specific design decision that resolves it. Any you consider out of scope for a HUD pass, say so and say who should own it.
6. Anything you would CUT. A top-10 game's HUD shows less, not more. Be willing to remove.

Judge ruthlessly and design decisively. The builder will implement exactly what you write, so be unambiguous about sizes, positions and behaviour.`, { label: 'oracle:hud-visual-pass', phase: 'Oracle', schema: REPORT, subagent_type: 'oracle' })

phase('Build')
const [b1, b2] = await parallel([
  () => agent(`${CONTEXT}

Read /Users/gary/dev/pipskeep/docs/hud-redesign.md and IMPLEMENT ITS HUD SPECIFICATION FAITHFULLY. The Oracle's summary: ${JSON.stringify(oracle?.summary ?? 'read docs/hud-redesign.md')}

You own the HUD: src/ui/topBar.ts, src/ui/xpBar.ts, src/ui/levelUp.ts, src/ui/milestoneCelebration.ts, their CSS (ui.css's top-bar sections and the xp/celebration CSS files), and src/ui/layers.test.ts if the ladder changes. Do NOT touch awaySheet.ts, dailies.ts, buildSheet.ts, lootReveal.ts (a peer agent owns those).

Deliver the redesign, and specifically resolve failures 3, 5, 6, 7 and 8:
- The XP bar becomes prominent, not the smallest bar on screen; it names the next tier's REAL headline unlock (read content/keep.ts's unlocks and pick the compelling one, not "+2 rows of ground"); it shows banked over-tier progress honestly instead of "460 / 300".
- The Ready affordance IS the tap target — tapping it opens the upgrade card. No inert pulsing chip beside a separate real one.
- Tier-up banner and milestone ribbon must not collide with the top bar at 375px. Follow the Oracle's placement.
- If the Oracle's design cuts or collapses parts of the top bar, CUT THEM — do not preserve the old dashboard out of caution.
Keep every aria-label (Phase 6 a11y) and add labels for anything new. Pure controllers + dumb DOM; unit-test the models (XP-within-tier math incl. banked overflow and max tier, next-carrot selection, collision-free placement decisions). Verify visually at 375px AND desktop, in the states the Oracle examined (1 pip vs 5, expedition, sulking, low needs, mid-gain, Ready). Report what you saw with measurements.`, { label: 'build:hud', phase: 'Build', schema: REPORT, model: 'sonnet' }),
  () => agent(`${CONTEXT}

Read /Users/gary/dev/pipskeep/docs/hud-redesign.md for context, then SURFACE THE INVISIBLE PROGRESSION. Oracle summary: ${JSON.stringify(oracle?.summary ?? 'read docs/hud-redesign.md')}

You own: src/ui/awaySheet.ts + src/ui/dailies.ts (the Doorstep), src/ui/lootReveal.ts, src/ui/buildSheet.ts + src/ui/buildMode.ts, and src/app/main.ts's catchup-on-visibilitychange wiring. Do NOT touch topBar.ts, xpBar.ts, levelUp.ts, milestoneCelebration.ts (peer agent owns the HUD).

Resolve failures 1, 2, 4, 9 and 10:
1. THE DOORSTEP BLOCKER — the most important fix in the round. On a return it must report the PROGRESSION, not just decay: Keep XP earned while away, what each staffed station produced, and — prominently — that a Keep tier is READY to purchase (with its headline unlock named). Keep it ONE warm surface with one button; do not add a sixth modal (2C's session shape is the constraint). \`deriveAwaySheet\` is pure and heavily tested — EXTEND its model with optional sections so the existing exact-copy assertions keep passing.
2. XP AT EVERY MOMENT — the loot reveal is the richest XP source and shows none. Add the XP gained to the reveal (and any other moment that grants XP but stays silent). The rule from spec §16 v1.3: written to state and visible to the player are separate criteria.
4. STATE THE SET BONUSES — the build sheet says "0 of 7 placed" and "· bonus active" but never WHAT the bonus is. Show the actual effect, at both the 3-member and 5-member thresholds, from content.
9. TAME THE BUILD SHEET — 45 cards is 13 screens of mobile scroll with near-identical copy. Group by set/category with collapsible sections or a filter, make each card scannable, and SHOW COST ON LOCKED CARDS (a locked card with no cost tells the player nothing).
10. STOP THE 3-MINUTE RE-GATE — every visibilitychange dispatches CATCHUP, so a brief tab-switch re-gates the session behind the full Doorstep and closes an open sheet. Catch-up must still run (needs must be correct), but the Doorstep must only appear for a genuinely meaningful absence, and returning must never destroy open UI state.

Pure controllers + dumb DOM; unit-test every model change (Doorstep sections incl. the tier-ready case and the no-progression case, reveal XP line, set-bonus copy, sheet grouping, the absence threshold). Verify visually at 375px: simulate a day-2 return with the debug time slider and confirm the Doorstep now names XP, production and a ready tier; confirm a 3-minute absence does NOT re-gate. Report what you saw.`, { label: 'build:surface-progression', phase: 'Build', schema: REPORT, model: 'sonnet' }),
])

phase('Integrate')
const integ = await agent(`${CONTEXT}

Builders finished. Oracle design: ${JSON.stringify(oracle?.summary ?? 'missing')} | HUD: ${JSON.stringify(b1?.summary ?? 'missing')} | progression surfacing: ${JSON.stringify(b2?.summary ?? 'missing')}

1. Full npm test + npm run build green; tsc clean. balance.test.ts, effects.balance.test.ts, reachability.test.ts and layers.test.ts MUST pass.
2. LAYERING SWEEP — the project's recurring hazard. Verify every overlay against every other at 375px: new top bar, XP bar, tier-up banner, milestone ribbon, Doorstep, loot reveal, Album, Long Meadow, Today sheet, build sheet, items satchel, focus view, keep bar, sound toggle, debug wrench, toast stack, recovery modal. Register everything in layers.test.ts. Nothing may occlude anything it does not intend to.
3. THE VISIBILITY TABLE — this codebase has shipped FIVE features that wrote state nothing read. Produce a table of every XP source and every building effect: where core applies it → where the player sees it. Anything with an empty second column is a finding.
4. Browser smoke at 375px AND desktop (restart the dev server first): a care tap visibly moves the XP bar; the loot reveal shows XP; tapping the Ready affordance opens the upgrade card; a tier-up banner does not collide with the top bar; a day-2 return Doorstep names XP + production + a ready tier; a 3-minute absence does not re-gate; the build sheet is scannable with set bonuses stated and costs on locked cards. Report REAL observations with measurements.`, { label: 'integrate', phase: 'Integrate', schema: REPORT })

phase('Verify')
const [gate, freshEyes, mutation] = await parallel([
  () => agent(`Gate runner for /Users/gary/dev/pipskeep round 2G. Run npm test + npm run build YOURSELF. Map to named passing tests, quoting assertions: (1) the Doorstep model carries XP-earned, station-production and tier-ready sections, with tests for each PLUS the empty case; (2) the loot reveal shows XP gained; (3) XP-within-tier math incl. banked over-tier progress and max tier; (4) the next-carrot selection picks a real headline unlock from content; (5) the Ready affordance is the tap target (a test asserting the handler is wired, not just rendered); (6) set-bonus copy states the actual effect at both thresholds; (7) the absence threshold prevents a short tab-switch from re-gating; (8) layers.test.ts covers every new surface. Also run the dead-feature grep: any promise rendered with no consumer. pass=true only on evidence you gathered yourself.`, { label: 'gate-runner', phase: 'Verify', schema: FINDINGS }),
  () => agent(`FRESH-EYES LEGIBILITY AUDIT for /Users/gary/dev/pipskeep round 2G. You have NOT seen this game before. Play it cold on a 375x812 viewport (dev server on 5317, kill stale vite first; the debug menu's time slider and grants let you simulate progression, and you may craft IndexedDB saves for high-level states).

Judge as a player, not a reviewer of code. Answer with measurements and specifics:
(a) Land on the game cold. What does your eye go to first? Is it the right thing? How much vertical space is chrome versus the actual pets?
(b) Can you tell, within 5 seconds, what you are progressing toward? Name it as the UI named it to you.
(c) Tap a care action. Did you SEE the reward — XP moving, numbers, feedback? Measure the XP bar's fill width in px and as a share of the screen.
(d) Simulate a day-2 return. Count the taps to reach normal play. Does the return moment tell you what you gained while away, or only what decayed?
(e) Trigger a tier-up and a milestone. Are the celebrations readable, or do they collide with anything?
(f) Open the build sheet. Can you tell what an item does and whether a set bonus is worth chasing? How many screens of scroll?
(g) Is the HUD now something you would call good for a game of this genre, or still a dashboard? Be blunt.
Findings for anything illegible, colliding, invisible, or requiring more than one tap to understand. pass=false if (b) or (d) fails.`, { label: 'audit:fresh-eyes', phase: 'Verify', schema: FINDINGS }),
  () => agent(`Mutation tester for /Users/gary/dev/pipskeep round 2G. Work is UNCOMMITTED — copy each target to the session scratchpad, restore + cmp after EACH cycle, NEVER git-restore. Mutations vs src (never tests): (1) the Doorstep's XP-earned section returns nothing; (2) its tier-ready section never appears even when a tier is affordable; (3) its station-production section is dropped; (4) the loot reveal's XP line is removed; (5) the Ready affordance's click handler is unwired (inert chip returns); (6) next-carrot selection falls back to the least interesting unlock; (7) banked over-tier progress renders as a raw ratio over 100%; (8) set-bonus effect copy reverts to "bonus active"; (9) the absence threshold is set to 0 so any tab-switch re-gates; (10) a new celebration surface is removed from the layer ladder so it can be occluded; (11) the XP bar's minimum visible advance is removed so a late-game care tap paints zero movement. For each: apply, npm test, record FAILED (good, name the catching test) or SURVIVED (major finding + the missing assertion). Mutations 1/2/4/5/8 are the round's whole point — a survivor there means the surfacing is untested and can silently regress to invisible, which is exactly how this project shipped five dead features. Finish with the suite green and git status showing only legitimate round-2G files.`, { label: 'audit:mutation', phase: 'Verify', schema: FINDINGS }),
])

const all = [gate, freshEyes, mutation].filter(Boolean)
const majors = all.flatMap(r => r.findings).filter(f => f.severity !== 'minor')
const minors = all.flatMap(r => r.findings).filter(f => f.severity === 'minor')

phase('Fix')
let fixReport = null
let regate = null
if (majors.length > 0) {
  fixReport = await agent(`${CONTEXT}

Fix these round-2G findings (majors mandatory, minors if cheap): ${JSON.stringify(majors)} Minors: ${JSON.stringify(minors)}. LEGIBILITY findings rank equal to correctness — this round exists because the game's depth was invisible. If a surface is still illegible, redesign it rather than nudging a value, and re-verify in the browser at 375px. End green: npm test + npm run build.`, { label: 'fixer', phase: 'Fix', schema: REPORT })
  regate = await agent(`In /Users/gary/dev/pipskeep: npm test + npm run build, and re-run and NAME balance.test.ts, effects.balance.test.ts, reachability.test.ts and layers.test.ts. Report real output. pass=true only if fully green and git status shows only legitimate round-2G files.`, { label: 're-gate', phase: 'Fix', schema: FINDINGS })
} else {
  log('No blocker/major findings — round 2G verified clean')
}

return {
  oracleDesign: oracle?.summary,
  hud: b1?.summary,
  surfacing: b2?.summary,
  integration: integ?.summary,
  legibilityVerdict: freshEyes?.notes,
  decisions: [oracle, b1, b2, integ].filter(Boolean).flatMap(x => x.decisions ?? []),
  gatePass: (regate ?? gate)?.pass ?? false,
  majorsFixed: majors,
  minorsOutstanding: minors,
  fixReport: fixReport?.summary ?? null,
}