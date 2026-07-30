export const meta = {
  name: 'phase5-the-keep',
  description: 'Grid placement, Keep levels, Pip wandering + gravitation, Gathering job, evolution ceremony',
  phases: [
    { title: 'Core', detail: 'grid/placement/levels/jobs/evolution application' },
    { title: 'UI', detail: 'wandering render + build mode / upgrades, in parallel' },
    { title: 'Integrate', detail: 'wire seams, full suite green' },
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

const SHARED = `Project: /Users/gary/dev/pipskeep. Read CLAUDE.md, then the PIPSKEEP_SPEC.md sections named in your task. Existing: complete core through Phase 4 (pips, care, expeditions, eggs, catchup with extraEvents seam, save v2 with migrations), full UI (top-bar pip selector, focus view, loot reveal, away sheet, debug menu), working game on :5317. content/keep.ts has level costs, content/decorations.ts has 6 entries, content/tuning.ts has job + roster numbers. Purity rules as ever. npm test + npm run build green before finishing. Do not commit; do not touch PROGRESS.md/.claude/.`

phase('Core')
const b1 = await agent(`${SHARED}

Spec sections: 9, 6.2, 6.3, 4.6, 7.4, 13 Phase 5. You own src/core/keep/, src/core/economy/ (spend logic), state.ts extensions, lifecycle evolution application, save schema v3.

1. Keep grid (core/keep/): 8x8 starting area (tuning); Level 2 adds a 4x8 plot (define the expanded bounds simply — a rows/cols growth in tuning). Placement: placeItem/moveItem/removeItem with footprint collision (content-defined footprints: Food Bowl 1x1, Bed 2x1, Gathering Station 2x2, decorations per registry), bounds checks, typed refusals. state.keep = { level, placements: Record<placementId, {itemId, x, y}> }.
2. Economy (core/economy/): canAfford/spend for resource bundles (typed, never negative). PURCHASE_KEEP_LEVEL action: exact bundle deduction (content/keep.ts costs), level 2 unlocks Forest (expedition gating already reads keepLevel), level 3 makes the ROSTER UPGRADE purchasable: PURCHASE_ROSTER_UPGRADE (cost in content) raises cap 3 -> 5 (tuning). Wire the upgraded cap into HATCH_EGG (it currently reads base cap — fix), and update the roster-full message to include the friendly upgrade nudge per spec 7.4.
3. Gathering job (spec 6.2): ASSIGN_JOB action -> machine assignJob at a placed Gathering Station (requires one placed; one pip per station); pip in AssignedJob produces 1 resource per 10 min (tuning) from the station's weighted table (Berries 70/Fiber 30, tuning) via the 'job' rng stream. Production ticks both live (TICK) and in catch-up (register jobTick events through the extraEvents seam; production obeys the 12h rate cap per spec 4.5/6.2 — needs decay during job per normal rates). UNASSIGN_JOB returns to Idle. Job survives reload (derived from lastProducedAt timestamps, no timers).
4. Evolution application (spec 4.6): EVOLVE_PIP action — legal ONLY when readyToEvolve; applies checkEvolution (target species + variant from lastGiftItemId), swaps speciesId/variant on the genome, keeps needs/personality/age, clears readyToEvolve, records evolvedAt. NEVER applied by TICK/CATCHUP (grep-proof: the only call site is the action).
5. Save schema v3 (keep + jobs fields): migration v2->v3 + fixtures/v3.json, deep validation of placements/level/jobs.
6. Tests (gate + more, FakeClock): placement collision/bounds/move/remove; placement survives serialize round-trip deep-equal; PURCHASE_KEEP_LEVEL exact deduction, refusal when short, Forest unlock flips assignExpedition legality; roster upgrade raises HATCH_EGG cap 3->5 (hatch 4th blocked before purchase, allowed after); gathering produces exactly 6/hour scaled by elapsed, obeys 12h cap offline (72h absence = exactly 12h x 6 = 72 resources), weighted table via seeded stream, one pip per station; EVOLVE_PIP only-on-action (72h avg-70 FakeClock run sets flag, TICK never evolves, action does), variant by lastGiftItemId incl. default fallback; ACKNOWLEDGE_REVEAL double-dispatch idempotency (a Phase 4 audit gap — add it).`, { label: 'build:keep-core', phase: 'Core', schema: REPORT })

phase('UI')
const [b2, b3] = await parallel([
  () => agent(`${SHARED}

Core builder finished: ${JSON.stringify(b1?.summary ?? 'inspect src/core yourself')}. Spec sections: 9 (diorama, wandering, gravitation, y-sorting), 4.3 (mood-informed idle), 11 (juice).

You own src/render/ ONLY (keepScene.ts and any new render modules). Do NOT touch ui/ or app/ (a parallel agent owns those; it will need render hooks — export them from keepScene: enterPlacementMode(itemId, onPlaced)/exitPlacementMode with grid-snap ghost preview + validity tinting, plus a pipTap seam like the existing eggTap for opening focus view / evolution tap).

1. Grid diorama: render the Keep as a tile area (soft checker only in placement mode, invisible in normal play), y-sorted layer so pips/placeables/eggs overlap correctly by depth (fake-iso per spec 9 — no isometric math). Level-2 plot extension renders when state.keep says so.
2. Placeables: procedural sprites via a resolver pattern (extend or mirror SpriteResolver conventions — single mapping from itemId -> drawn container): Food Bowl (bowl + berries), Bed (cushion), Gathering Station (basket + tools), the 6 decorations from content. Placement ghost: grid-snapped, green/red validity tint, drop animation (squash + dust poof) on confirm.
3. ALL roster pips visible and wandering (spec 9): random walk between free tiles — pick a free target tile, amble with a gentle waddle, pause, idle (bob/blink); Piplings shorter strides. Gravitation: Resting pip beelines to (and naps on) a placed Bed; a pip with hunger < 40 loiters near the Food Bowl; AssignedJob pip stands at its station doing a working loop (rummage animation + occasional produced-item pop). OnExpedition pips are absent (already handled). Sulking pips slump in a corner tile. Approximate is fine, ALIVE is the goal.
4. Evolution ceremony: readyToEvolve pip gets a soft pulsing glow + occasional sparkle; the pipTap seam reports taps; when ui dispatches EVOLVE_PIP, play the showstopper on lastEvolveOutcome: gather-light, white flash, silhouette swap to the evolved species sprite, confetti + fanfare sound slot, then the evolved pip does the happy wiggle. Under 4s total.
5. Active pip indicator: subtle ring/marker under the active pip so selection still reads with a crowd.
6. Tests: pure logic bits (tile math, free-tile picking determinism via seeded stream, y-sort comparator) unit-tested; visual verified via your own browser QA on :5317 (or a second vite port if busy).`, { label: 'build:keep-render', phase: 'UI', schema: REPORT }),
  () => agent(`${SHARED}

Core builder finished: ${JSON.stringify(b1?.summary ?? 'inspect src/core yourself')}. Spec sections: 9 (placement UI), 10 (views), 6.2, 15.5 (tone).

You own src/ui/ + src/app/main.ts wiring. Do NOT touch src/render/ (a parallel agent owns it; it exports enterPlacementMode/exitPlacementMode and a pipTap seam from keepScene — code against those, stub locally in ONE commented place if absent at your moment).

1. Build mode: a "Build" affordance (top bar or a small hammer button) -> bottom sheet listing placeables + decorations with resource-bundle costs (affordable = enabled, short = greyed with the missing amounts, friendly), tap -> placement mode via the render hooks (tap-to-place, move/remove existing via tap-and-hold or a select-then-move pattern — keep it thumb-friendly), placement dispatches PLACE_ITEM etc.
2. Keep level upgrade: a cozy "Keep Level N" chip; opens a card showing the next level's cost bundle + what it unlocks ("Level 2: the Forest trail opens, plus room to build"), Purchase button dispatching PURCHASE_KEEP_LEVEL; roster upgrade purchase appears at level 3. On level-up: celebratory toast + confetti via notify/sound seams.
3. Gathering job UX: focus view gains an "Assign to Gathering Station" row when one is placed (occupancy shown, on-tone refusals surface); assigned pip's selector chip gets a tiny basket glyph; station production pops surface as small toasts sparingly (batch, do not spam).
4. Evolution UX: wire the render pipTap seam -> tapping a GLOWING pip shows a tiny confirm bubble ("Something wants to change…" / Evolve) dispatching EVOLVE_PIP; non-glowing taps open the focus view as before (activate/switch). Update the roster-full toast to the new upgrade-nudge message from core.
5. Items sheet: Give-item flow already exists — make sure gift items show a hint that gifts are remembered ("Mosspip will remember this" microcopy) since lastGiftItemId drives variants.
6. Tests: pure controllers (build-sheet affordability model, upgrade card model, assign-row occupancy) unit-tested; browser QA your flows on :5317 or a second port.`, { label: 'build:keep-ui', phase: 'UI', schema: REPORT }),
])

phase('Integrate')
const integ = await agent(`${SHARED}

Builders: core ${JSON.stringify(b1?.summary ?? 'missing')}; render ${JSON.stringify(b2?.summary ?? 'missing')}; ui ${JSON.stringify(b3?.summary ?? 'missing')}. Make the seams meet: placement-mode hooks wired both directions, pipTap -> evolution confirm vs focus-view open, no duplicate action types, tsc clean, FULL npm test green, npm run build green, and a real browser smoke on :5317 (or spare port): place a Food Bowl, buy nothing you cannot afford (grant via debug menu first if needed), assign gathering, verify pips wander. Fix integration friction; report changes.`, { label: 'integrate', phase: 'Integrate', schema: REPORT })

phase('Verify')
const [gate, audit, mutation] = await parallel([
  () => agent(`Gate runner for /Users/gary/dev/pipskeep Phase 5 (PIPSKEEP_SPEC.md section 13 Phase 5 — read it). Run npm test + npm run build YOURSELF. Map clauses to named passing tests: (1) place/move/remove survives reload (serialize deep-equal incl. placements); (2) Keep level 2 purchase deducts the exact bundle and unlocks Forest (assignExpedition legality flip tested); (3) evolution readiness under FakeClock care simulation (lifetime-average mechanism) sets the flag, EVOLVE_PIP action alone applies it, TICK/CATCHUP never do; (4) lastGiftItemId selects the variant with default fallback; (5) gathering: 1/10min from the seeded weighted table, one pip per station, 12h offline cap (72h -> exactly 72 resources); (6) roster upgrade raises the hatch cap 3->5 end-to-end; (7) schema v3 migration fixture passes. Wandering/gravitation are visual — check the integrator's browser evidence exists, note it, do not fail on it. pass only on full evidence.`, { label: 'gate-runner', phase: 'Verify', schema: FINDINGS }),
  () => agent(`Spec/tone audit for /Users/gary/dev/pipskeep Phase 5 vs PIPSKEEP_SPEC.md sections 4.6, 6.2, 6.3, 7.4, 9, 12, 15.5 (read first). (1) Grid 8x8 + level-2 4x8 from tuning; costs from content; NO isometric grid math (spec 9 — y-sorting only). (2) Scope fence: no attraction buildings beyond the registry no-op effect field, no crafting, no breeding UI; job system structured as a registry so Crafting slots in later (spec 6.2). (3) Evolution: player-witnessed only — grep for EVOLVE application outside the action reducer. (4) Roster-full message now has the upgrade nudge (7.4). (5) All copy warm/mischievous; flag corporate strings. (6) Purity re-grep (Date.now/Math.random/pixi-in-core) + tuning literals in core. (7) HATCH_EGG respects the upgraded cap. pass=true only if zero blocker/major.`, { label: 'audit:spec-tone', phase: 'Verify', schema: FINDINGS }),
  () => agent(`Mutation tester for /Users/gary/dev/pipskeep. Phase 5 work is UNCOMMITTED — copy targets to /tmp, restore + cmp after each cycle, NEVER git-restore. Mutations vs src (never tests): (1) placement collision check removed; (2) PURCHASE_KEEP_LEVEL skips deduction; (3) purchase succeeds when short on resources; (4) gathering produces while pip is Idle (not AssignedJob); (5) gathering ignores the 12h offline cap; (6) TICK auto-applies evolution when readyToEvolve; (7) variant selection ignores lastGiftItemId (always default); (8) placements dropped from serialization; (9) HATCH_EGG ignores the purchased roster upgrade (stays capped at 3). For each: apply, npm test, FAILED (good) or SURVIVED (major + missing assertion named), restore + cmp. Finish: suite green, git status only legit files.`, { label: 'audit:mutation', phase: 'Verify', schema: FINDINGS }),
])

const all = [gate, audit, mutation].filter(Boolean)
const majors = all.flatMap(r => r.findings).filter(f => f.severity !== 'minor')
const minors = all.flatMap(r => r.findings).filter(f => f.severity === 'minor')

phase('Fix')
let fixReport = null
let regate = null
if (majors.length > 0) {
  fixReport = await agent(`${SHARED}

Fix these Phase 5 findings (majors mandatory, minors if cheap): ${JSON.stringify(majors)} Minors: ${JSON.stringify(minors)}. End green: npm test + npm run build.`, { label: 'fixer', phase: 'Fix', schema: REPORT })
  regate = await agent(`In /Users/gary/dev/pipskeep: npm test + npm run build. Real output. pass=true only if fully green and git status shows only legitimate Phase 5 files.`, { label: 're-gate', phase: 'Fix', schema: FINDINGS })
} else {
  log('No blocker/major findings — Phase 5 verified clean')
}

return {
  core: b1?.summary,
  render: b2?.summary,
  ui: b3?.summary,
  integration: integ?.summary,
  decisions: [b1, b2, b3, integ].filter(Boolean).flatMap(b => b.decisions ?? []),
  gatePass: (regate ?? gate)?.pass ?? false,
  majorsFixed: majors,
  minorsOutstanding: minors,
  fixReport: fixReport?.summary ?? null,
}