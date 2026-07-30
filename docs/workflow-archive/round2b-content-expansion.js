export const meta = {
  name: 'round2b-content-expansion',
  description: 'Big content expansion: 6+ species with evolution lines, new biomes/expeditions, foods, decorations, dialogue variety — content-only, reachability-verified',
  phases: [
    { title: 'Design', detail: 'progression curve + species bible before any authoring' },
    { title: 'Author', detail: 'species/art, expeditions/economy, foods+decor in parallel' },
    { title: 'Integrate', detail: 'wire, validate registries, full suite green' },
    { title: 'Verify', detail: 'gate runner + reachability/tone audit + mutation tester' },
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

const CONTEXT = `Project: /Users/gary/dev/pipskeep (PipsKeep, 962 tests green, v1.0 shipped then round-2A playtest fixes landed). Read CLAUDE.md and PIPSKEEP_SPEC.md §3 (content-as-data), §11 (art standard), §0 (vocabulary), §15.5 (tone), and §16's v1.2 changelog (the round-2A amendments) FIRST.

THE PRIME DIRECTIVE OF THIS ROUND: spec §3 promises that adding a species, food, or expedition NEVER requires touching core/. This round is the proof. Work in src/content/ (+ src/render/spriteResolver.ts ONLY where a genuinely new visual primitive is needed). If you find yourself needing a core/ change, STOP and report it as a §3 violation finding instead of making it.

Round-2A context you must respect:
- Decay: −3.8/−3.7/−3.6/−3.5 per hour, offline cap 16h, personality multipliers within [0.8, 1.3].
- Restore sizing rule: ONE care session must out-restore ONE full capped (16h) absence for every personality, else day 2 is worse than day 1. Berry +45, Stew +75/+15 today.
- Economy: Meadow (lvl 1) berry/fiber/wood, Forest (lvl 2) wood-heavy, Shore (lvl 3) shell/driftwood. Level 2 = 5 wood + 6 fiber (~33 min engaged play). Gathering Station 3 wood + 2 fiber, deliberately cheaper than the level it funds.
- src/core/economy/reachability.test.ts proves every gated cost is obtainable from the PREVIOUS tier's activities and is data-driven off the registries — it will automatically police everything you add. Keep it passing; that is the deadlock guard.
- src/core/pips/balance.test.ts encodes the feel targets. Keep it passing.

npm test + npm run build green before you finish. Do not commit. Do not touch PROGRESS.md or .claude/.`

phase('Design')
const design = await agent(`${CONTEXT}

You are the content designer. Produce THE BIBLE for this expansion — a written plan the authors will implement. Write it to /Users/gary/dev/pipskeep/docs/content-bible.md (create docs/). Do not author the registries yourself; design them.

1. SPECIES (target 7 total including Mosspip): each needs an id, display name following the §0 compound-diminutive convention (Mosspip, Emberpip, Snowpip are the spec's examples — invent the rest in that spirit), a personality-neutral flavor identity, a palette direction (soft pastels + ONE vibrant accent per §11), a pattern motif, rarity weight, and a TWO-STAGE evolution line (base → evolved) with the gift-item variants that select between forms. Mosspip already exists with grovepip as its evolved form and berry/stew gift variants — keep and extend, do not rewrite. Species must feel like a SET worth completing: vary them along readable axes (element/biome affinity, silhouette weight, temperament flavor) rather than being palette swaps.
2. BIOMES/EXPEDITIONS (target 6 total): keep Meadow/Forest/Shore, add 3 more with distinct loot identities and unlock tiers. Design the FULL progression curve: which Keep level gates which expedition, what each drops, durations, egg chances, and which species each biome's eggs can produce (this is the collection engine — species should be FOUND in themed places, so a completionist has somewhere specific to go for each). Show the reachability arithmetic for every gated cost as a table — the reachability test will check you, so do the math first.
3. FOODS (target 8-10): each with hunger restore, side effects, and where it drops. RESPECT THE RESTORE SIZING RULE above — state for each food how many are needed to cover a capped absence. Include at least one食 that is a treat rather than a meal (small restore, big happiness) and one that is a proper feast.
4. DECORATIONS (target 15+) and any new placeables: costs as resource bundles, footprints, and what they say about the player who chose them. Decorations are trophy-adjacent — the Pipdex/gamification round will lean on them.
5. DIALOGUE: personalities stay at FIVE (dialogue is keyed personality × context, so species do NOT multiply the corpus — confirm this in your plan). Instead specify SPECIES FLAVOR LINES: a small per-species pool (~4 lines) used on hatch/evolution/first-meeting so new species feel characterful without a 6× authoring explosion. Specify the exact shape so the registry stays typed.
6. Call out every risk: anything that could break balance, reachability, the restore rule, or the §3 no-core-changes promise.

Be specific and opinionated — the authors will implement exactly what you write. Names and flavor must be warm, mischievous, memeable, and free of any §0 forbidden vocabulary.`, { label: 'design:content-bible', phase: 'Design', schema: REPORT })

// ORCHESTRATOR RULINGS on the findings the design pass raised. These are
// decided; do not re-litigate them, and do not ask — implement them.
const AUTH = `

=== ORCHESTRATOR AUTHORIZATIONS (decided — implement, do not re-open) ===
The content bible raised four §3 / scope questions. Rulings:

1. BIOME-THEMED EGG POOLS: **APPROVED as a core change.** Patch core/state.ts's HATCH_EGG to pass egg.sourceExpeditionId through to rollGenome so an egg's species pool comes from the biome it was found in. Reasoning: §3's promise is that ADDING CONTENT never requires a core change; per-biome pools are a new FEATURE (the collection engine), so it is not a §3 violation. Hard constraint: the RNG cursor contract must be preserved EXACTLY — rollGenome must consume the same number of rolls regardless of which pool is used, so existing saves keep deterministic futures. Prove it with a test that a fixed seed advances the cursor identically for two different biome pools. Keep the patch minimal.
2. EVOLVED FORMS HATCHING FROM EGGS: **fix it.** grovepip is rarity "uncommon", so roughly one egg in five currently hatches a fully-evolved Grovepip, which cheapens evolution. Implement the zero-weight "lineage" rarity tier so evolved forms can only be reached by evolving, and cover it with a test.
3. GIFT VARIANTS ARE INVISIBLE: **fix it.** pip.evolved.variantId is written by applyEvolution and read by NOBODY, so every gift-selected evolution variant is currently dead code and the §4.6 feature does not exist on screen. Wire the resolver/scene to render the stored variant. This is a real bug, not polish.
4. FENCE EXCEPTIONS: **granted** for exactly these, beyond content/ and spriteResolver.ts — render/placeableSprites.ts (otherwise 15 new decorations all ship as identical crates), the ~2 lines in render/keepScene.ts needed for gift variants, loot-reveal rarity tiers in ui/lootReveal.ts, job copy, and the species flavor-line call sites. Anything beyond that list: report instead of doing.

DECLINED (design around them, as the bible already does): adding a 5th entry to RESOURCE_IDS, and widening the KeepLevel union past 3. The bible's six-biomes-across-three-tiers structure is the approved shape.

NOTE FOR CONTEXT (do not build it this round): the bible is right that this expansion is half a feature without a Pipdex, storage, and seen/caught records — 14 forms against a roster cap of 5. That is the NEXT round's job. Design your data so it is ready: species/variant identity must be recoverable from a hatched pip, and anything a future collection log would need to record should be present in state rather than inferred.
=== END AUTHORIZATIONS ===`;

phase('Author')
const [a1, a2, a3] = await parallel([
  () => agent(`${CONTEXT}${AUTH}

The content bible is at /Users/gary/dev/pipskeep/docs/content-bible.md — READ IT and implement its species section faithfully. Designer summary: ${JSON.stringify(design?.summary ?? 'read the bible file')}

You own src/content/species.ts, src/content/palette.ts, and src/render/spriteResolver.ts (visual primitives only). Do NOT touch expeditions/foods/decorations/tuning.

1. Author every species from the bible: registry entries with evolution lines, gift-item variant mappings, rarity weights, and the species flavor-line pools the bible specifies.
2. Palette tokens for each species (soft pastels + one vibrant accent, §11) — they must be visually DISTINCT at a glance, including in the small top-bar portrait chips. Check contrast against the pastel ground so no pip disappears into the background.
3. spriteResolver: add whatever new visual primitives the bible's motifs require (new pattern overlays, silhouette variants, accessory shapes) — composed procedurally from the genome exactly as today. Every species must render through the SINGLE resolver path; adding a species must not require new render code afterwards. Piplings and shiny variants must work for every new species automatically.
4. Verify visually: run the dev server and use the debug menu's Spawn egg + save import, or write a temporary in-page harness, to render EVERY species (base + evolved, adult + pipling, normal + shiny) and confirm each is distinct and charming. Remove any harness afterwards. Report what you saw per species.
5. Keep content/validate.ts passing (broken evolution targets are a loud error) and extend it if the new data has new failure modes.`, { label: 'author:species-art', phase: 'Author', schema: REPORT, model: 'sonnet' }),
  () => agent(`${CONTEXT}${AUTH}

The content bible is at /Users/gary/dev/pipskeep/docs/content-bible.md — READ IT and implement its expedition/economy section faithfully. Designer summary: ${JSON.stringify(design?.summary ?? 'read the bible file')}

You own src/content/expeditions.ts, src/content/keep.ts, src/content/jobs.ts, and the economy-related parts of src/content/tuning.ts. Do NOT touch species/palette/foods/decorations.

1. Author the new expeditions with their loot tables, durations, egg chances, unlock tiers, and per-biome species-egg pools per the bible.
2. Extend the Keep level ladder if the bible calls for more tiers; author costs as resource bundles.
3. THE HARD REQUIREMENT: src/core/economy/reachability.test.ts must pass for EVERY gated cost — each tier purchasable from the previous tier's activities. Run it constantly while authoring; it is your oracle. If the bible's numbers fail it, fix the NUMBERS and report the correction (the bible is a plan, the test is the truth).
4. Verify the curve does not collapse: later expeditions must be strictly better per-minute than earlier ones for their target resources, or unlocking them is pointless (round 2A found the Forest was briefly a wood-per-minute DOWNGRADE from the Meadow — do not repeat that). Produce a per-minute yield table by resource per expedition in your report and check monotonicity.
5. Add tests for the new content shape where the existing expedition tests have gaps (e.g. every expedition's egg pool references real species ids; every loot item exists in a registry).`, { label: 'author:expeditions-economy', phase: 'Author', schema: REPORT, model: 'sonnet' }),
  () => agent(`${CONTEXT}${AUTH}

The content bible is at /Users/gary/dev/pipskeep/docs/content-bible.md — READ IT and implement its foods/decorations section faithfully. Designer summary: ${JSON.stringify(design?.summary ?? 'read the bible file')}

You own src/content/foods.ts, src/content/decorations.ts, src/content/placeables.ts, and the care/food-related parts of src/content/tuning.ts. Do NOT touch species/palette/expeditions/keep.

1. Author the foods with restores and side effects per the bible. ENFORCE THE RESTORE SIZING RULE: one care session must out-restore one full 16h capped absence for the worst-case personality. Show the arithmetic per food in your report and verify src/core/pips/balance.test.ts still passes.
2. Author the decorations and any new placeables with resource-bundle costs and footprints. Costs must keep reachability passing.
3. Give every item warm, opinionated flavor text — these strings appear in the items sheet and build menu, so they are player-facing copy and must carry the game's voice (§15.5). No filler like "A nice decoration."
4. Where gift items drive evolution variants (§4.6, lastGiftItemId), coordinate with the species author's variant mappings via the bible — every gift variant referenced by a species must exist as a real item id. content/validate.ts should catch mismatches; extend it if it does not.
5. Add tests for new failure modes (unknown item in a cost bundle, gift variant referencing a nonexistent food, negative restores).`, { label: 'author:foods-decor', phase: 'Author', schema: REPORT, model: 'sonnet' }),
])

phase('Integrate')
const integ = await agent(`${CONTEXT}${AUTH}

Authors finished. species/art: ${JSON.stringify(a1?.summary ?? 'missing')} | expeditions/economy: ${JSON.stringify(a2?.summary ?? 'missing')} | foods/decor: ${JSON.stringify(a3?.summary ?? 'missing')}

Make it all cohere:
1. Cross-registry integrity: every species egg pool, gift variant, loot item, and cost bundle references something real. content/validate.ts must catch every class of mismatch — extend it and prove it with tests.
2. Full npm test + npm run build green; tsc clean. Reachability and balance tests MUST pass — they are the round's guardrails.
3. THE §3 PROOF: confirm and report whether ANY core/ file needed to change for this expansion. If one did, name it and explain why — that is a headline finding, not a footnote.
4. UI sanity: the items sheet, build sheet, and focus view must handle the larger catalogs without overflowing on a mobile viewport (375px). Fix layout/scrolling in src/ui/ if the bigger lists break it — that IS your job.
5. Browser smoke on :5317 (restart the dev server first — stale HMR has bitten this project repeatedly): grant resources via debug, open the build sheet and items sheet, confirm the new content renders and scrolls, spawn and hatch eggs to see new species. Report what you actually saw, with real observations.`, { label: 'integrate', phase: 'Integrate', schema: REPORT, model: 'sonnet' })

phase('Verify')
const [gate, audit, mutation] = await parallel([
  () => agent(`${AUTH}

Gate runner for /Users/gary/dev/pipskeep round 2B. Run npm test + npm run build YOURSELF. Verify with evidence: (1) species count and every one has a valid evolution line + gift variants that reference real items; (2) expedition count with valid loot tables, egg pools referencing real species, and unlock tiers; (3) reachability test passes and actually COVERS the new costs (read it — confirm it is data-driven, not hardcoded to the old three levels; if new tiers are not covered, that is a major finding); (4) balance test still passes with the new foods; (5) content/validate.ts catches cross-registry mismatches — prove it by temporarily pointing one gift variant at a nonexistent item and confirming validation errors, then restoring; (6) the §3 promise: run 'git diff --stat' and report whether ANY file under src/core/ changed this round. pass only on evidence you gathered.`, { label: 'gate-runner', phase: 'Verify', schema: FINDINGS, model: 'sonnet' }),
  () => agent(`${AUTH}

Content quality + tone audit for /Users/gary/dev/pipskeep round 2B vs PIPSKEEP_SPEC.md §0, §3, §11, §15.5. (1) READ EVERY new player-facing string (species names/flavor, expedition names/flavor, food and decoration names/flavor, species lines) — flag filler, off-tone, corporate, bleak, or generic copy; flag any §0 forbidden vocabulary (Pal, gotchi, pokemon, palworld, tamagotchi, case-insensitive, whole repo); confirm species names follow the compound-diminutive convention. (2) Do the species feel like a SET worth completing, or are they palette swaps? Judge honestly and name the weakest one. (3) Are the biomes distinct in loot identity and mood, or interchangeable? (4) Is the progression curve legible to a player — does each unlock feel like a step up? (5) Check the balance implication of every new food against the one-session-out-restores-one-absence rule and report the arithmetic. (6) Scope fence (§12): no breeding UI, no seasonal events (the availableWindow field may EXIST but must be unused), no attraction buildings beyond the registry no-op. pass=true only if zero blocker/major.`, { label: 'audit:content-tone', phase: 'Verify', schema: FINDINGS, model: 'sonnet' }),
  () => agent(`${AUTH}

Mutation tester for /Users/gary/dev/pipskeep round 2B. Work is UNCOMMITTED — copy targets to the session scratchpad, restore + cmp after EACH cycle, NEVER git-restore. Mutations vs src (never tests): (1) point a species' evolution target at a nonexistent species id; (2) point a gift variant at a nonexistent food id; (3) put an unknown resource in a decoration cost bundle; (4) make a new Keep tier cost a resource that only its OWN unlocked expedition drops (re-introduce the deadlock shape one tier up — the reachability test MUST catch this); (5) set a new expedition's egg pool to a nonexistent species; (6) drop a new food's hunger restore to 5 so one session no longer covers an absence (the balance test should catch it, or report the gap); (7) make a new expedition strictly worse per-minute than its predecessor for its headline resource; (8) remove a new species from the rarity-weight table so it can never be rolled. For each: apply, npm test, record FAILED (good, name the catching test) or SURVIVED (major finding + the missing assertion). Surviving mutations here are especially important: this round's content will grow, and untested content invariants rot fastest. Finish with the suite green and git status showing only legitimate round-2B files.`, { label: 'audit:mutation', phase: 'Verify', schema: FINDINGS, model: 'sonnet' }),
])

const all = [gate, audit, mutation].filter(Boolean)
const majors = all.flatMap(r => r.findings).filter(f => f.severity !== 'minor')
const minors = all.flatMap(r => r.findings).filter(f => f.severity === 'minor')

phase('Fix')
let fixReport = null
let regate = null
if (majors.length > 0) {
  fixReport = await agent(`${CONTEXT}${AUTH}

Fix these round-2B findings (majors mandatory, minors if cheap): ${JSON.stringify(majors)} Minors: ${JSON.stringify(minors)}. Content-quality findings (weak copy, palette-swap species, interchangeable biomes) are as important as correctness findings — rewrite rather than patch. End green: npm test + npm run build.`, { label: 'fixer', phase: 'Fix', schema: REPORT, model: 'sonnet' })
  regate = await agent(`In /Users/gary/dev/pipskeep: npm test + npm run build. Report real output, and re-run the reachability + balance tests specifically, naming them. pass=true only if fully green and git status shows only legitimate round-2B files.`, { label: 're-gate', phase: 'Fix', schema: FINDINGS, model: 'sonnet' })
} else {
  log('No blocker/major findings — round 2B verified clean')
}

return {
  bible: design?.summary,
  species: a1?.summary,
  expeditions: a2?.summary,
  foodsDecor: a3?.summary,
  integration: integ?.summary,
  coreUntouched: 'see gate-runner finding 6',
  decisions: [design, a1, a2, a3, integ].filter(Boolean).flatMap(x => x.decisions ?? []),
  gatePass: (regate ?? gate)?.pass ?? false,
  majorsFixed: majors,
  minorsOutstanding: minors,
  fixReport: fixReport?.summary ?? null,
}