export const meta = {
  name: 'phase6-polish-pwa',
  description: 'Onboarding + first-90-seconds, PWA offline, perf budgets + README, polish pass, two delight features',
  phases: [
    { title: 'Build', detail: 'onboarding, then PWA/README/perf + polish/delight in parallel' },
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
    perf: { type: 'object', description: 'any measured numbers: gzip sizes, TTI, fps' },
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

const SHARED = `Project: /Users/gary/dev/pipskeep. Read CLAUDE.md, then the PIPSKEEP_SPEC.md sections named in your task. The game is feature-complete through Phase 5 (632 tests green): full care loop, expeditions, eggs, the Keep with placement/levels/jobs/evolution, wandering pips, save v3 with migrations, debug menu. Purity rules as ever. npm test + npm run build green before finishing. Do not commit; do not touch PROGRESS.md/.claude/.`

phase('Build')
const b1 = await agent(`${SHARED}

Spec sections: 7.1, 10, 10.1 (THE acceptance bar — read it twice), 15.5. You own onboarding: src/ui/onboarding.ts (+ any onboarding css module), boot changes in src/app/main.ts, and a small state addition.

1. New-game flow (replaces silent createNewGame): Title card — "PipsKeep" wordmark, soft pastel, tap anywhere. Three starter Pips bounce in (SAME species, three DISTINCT palettes + personalities rolled deterministically from the genesis stream; show each with a one-line personality intro drawn from its blurb). Player taps one — the other two wave goodbye cheerfully and amble off (spec: "they're fine" — the copy should radiate that). Chosen Pip lands in the Keep, happy wiggle, says a line. Hunger starts ~60 (already the case).
2. Guided beats (10.1): prompt "Pips get hungry! Try feeding them." with a soft highlight on Feed; after the feed lands (juicy — verify the existing animation chain plays), prompt "Pips love exploring." nudging the focus view + Meadow send; after send, free play (a last toast "See you in five minutes!"). Track progress in state.onboarding = { completed: boolean, step } (schema addition — coordinate with the polish agent who owns the v4 migration bump; if you land first, do the bump yourself per the existing migrate.ts pattern + fixture, and tell the merge note in your report).
3. Skippable (spec 10: onboarding <= 60s, skippable): a quiet "Skip" in the corner of every guided beat — skipping picks nothing? No: skipping the STARTER PICK is impossible (a pip must exist) — Skip appears only after the pick, and jumps straight to free play with onboarding.completed=true.
4. Existing saves: onboarding.completed defaults true in migration (only fresh games see it).
5. Tests: pure controller (step progression, skip semantics, deterministic starter trio from a seed, existing-save bypass); keep DOM shell dumb.`, { label: 'build:onboarding', phase: 'Build', schema: REPORT })

const [b2, b3] = await parallel([
  () => agent(`${SHARED}

Onboarding builder finished: ${JSON.stringify(b1?.summary ?? 'inspect the repo')}. Spec sections: 1 (perf budgets + PWA), 14 (deliverables/README). You own: PWA setup, perf measurement harness, README.md.

1. PWA: add vite-plugin-pwa (EXPLICITLY permitted dev dep, spec 1) — installable manifest (name PipsKeep, short_name PipsKeep, portrait, theme/bg colors from the palette), icons: author a cute pip-blob SVG icon, produce the required PNG sizes (192/512 + maskable) — macOS 'sips' or 'qlmanage' can rasterize, or draw via a tiny node canvas-free PNG encoder if simpler; no new runtime deps. Service worker: cache-first for all built assets (workbox generateSW via the plugin), network-independent gameplay (there are no network calls — verify with a grep for fetch/XHR outside the SW). autoUpdate registration in main.ts.
2. Perf harness (dev-only, like debugMenu): a ?perf query flag that (a) overlays an fps meter (rAF delta ring buffer, p95 frame time), (b) spawns a LOCAL-ONLY perf scene — 5 animated pips + 30 decorations rendered via the real resolvers WITHOUT touching the store/save (construct synthetic state for the scene layer only). This makes the spec-1 budget measurable now and forever.
3. Measure and REPORT (do not write PROGRESS.md): gzip sizes of app-code vs pixi chunks from the build (budgets: app <= 350KB gz excluding pixi, <= 550KB gz total); dist total; a rough TTI proxy (vite preview + curl timing is fine, note methodology).
4. README.md (spec 14): run instructions (npm install && npm run dev, port 5317), architecture overview (the section-2 tree + one paragraph each: injected Clock, seeded rng cursors in state, one-way flow, content-as-data), and the PROOF walkthrough: "add a species / a food / an expedition by editing content/ only" — step-by-step with real file names, explicitly noting zero core/ changes (spec 3's acceptance). Tone: professional but with the game's warmth in examples. Also document the debug menu + ?perf flag.
5. Tests: any pure logic you add (fps ring buffer). Suite + build green.`, { label: 'build:pwa-readme', phase: 'Build', schema: REPORT }),
  () => agent(`${SHARED}

Onboarding builder finished (may have bumped schema v4 — check src/core/save/migrate.ts and coordinate; if you both bump, merge into ONE v4). Spec sections: 0, 3, 4.3, 11, 15.5. You own the polish + delight pass: content/dialogue touch-ups, top bar, a11y, spriteResolver + genome, and two SURPRISE features the project owner should discover by playing, not by reading this prompt (keep names/details out of user-facing docs; code comments fine).

POLISH:
1. Berry dedupe: the top bar shows 'Berry x7' (inventory food) AND 'Berry x20' (resource) as twin chips. Resolve properly: berries are FOOD (inventory). Remove 'berry' from RESOURCE_IDS if present, migrate any resource-berries into inventory in the v4 migration, fix the debug grant, and make the top bar unambiguous.
2. A11y: every icon-only/unlabeled button gets aria-label (care bar, wrench, chips); the six care buttons especially (they currently read as unnamed buttons to assistive tech).
3. Dialogue dedupe: 4 cross-personality near-duplicate jokes were flagged in the Phase 2 audit — find near-dupes across src/content/dialogue/*.ts (same skeleton/punchline), rewrite the weaker twin in its owner's voice.
4. Mood-idle polish check: verify each mood's idle set actually differs visibly (spec 4.3); strengthen Miserable vs Grumpy if they read the same.

DELIGHT (the surprises — small, cosmetic-adjacent, zero grind):
5. SHINY PIPS: genome gains shiny: boolean (v4 migration, default false; rollGenome rolls it at tuning.genome.shinyChance — pick something rare-but-findable ~2-3%; deterministic from the egg stream). Shiny pips: subtle iridescent tint shift + occasional sparkle particles via the resolver/scene, sparkle burst + a one-off toast on hatch ("…is that glitter?"). Shiny status survives evolution. Tests: deterministic roll, migration default, evolution preserves it.
6. PIP PARADE: tapping the "Keep Lv" chip 7 times within ~4s triggers a one-off cosmetic parade — every roster pip (plus piplings trailing) congas across the foreground with confetti and a sound('parade.kazoo') slot, then they amble back to whatever they were doing. MUST be pure cosmetics: zero dispatches, zero state reads beyond the roster, works in prod builds, cannot interrupt care animations mid-flight (queue after). A tiny wink line from a random pip when it ends.
Tests: parade trigger counter logic (pure), no-dispatch guarantee (the controller takes no store.dispatch reference at all — enforce by construction).`, { label: 'build:polish-delight', phase: 'Build', schema: REPORT }),
])

phase('Integrate')
const integ = await agent(`${SHARED}

Builders: onboarding ${JSON.stringify(b1?.summary ?? 'missing')}; pwa/readme ${JSON.stringify(b2?.summary ?? 'missing')}; polish/delight ${JSON.stringify(b3?.summary ?? 'missing')}. Make the seams meet: exactly ONE v4 migration (merge if both builders bumped), onboarding plays nice with the PWA boot + away sheet ordering (fresh game must NOT show an away sheet or stale toasts), full npm test green, npm run build green, service worker present in dist, and a browser smoke of a FRESH game (clear idb via devtools protocol or an incognito-equivalent context): title -> pick -> guided feed -> guided send -> free play. Report what you fixed.`, { label: 'integrate', phase: 'Integrate', schema: REPORT })

phase('Verify')
const [gate, audit, mutation] = await parallel([
  () => agent(`Gate runner for /Users/gary/dev/pipskeep Phase 6 (PIPSKEEP_SPEC.md section 13 Phase 6 + section 1 budgets — read both). Run npm test + npm run build YOURSELF. Verify with evidence: (1) dist contains manifest + registered service worker with precache covering all assets (list what is NOT precached); (2) gzip budgets: app code <= 350KB excluding pixi, total <= 550KB — measure the actual dist chunks yourself with gzip -c | wc -c and report exact numbers; (3) onboarding controller tests pass incl. skip + existing-save bypass; (4) schema v4 migration fixture exists and passes; (5) README contains the content-only add-a-species walkthrough naming real files; (6) no fetch/XHR in app code outside the SW layer. Airplane-mode + Lighthouse + live first-90s are the orchestrator's browser checks — note them as handed off, do not fail on them. pass only on full evidence for 1-6.`, { label: 'gate-runner', phase: 'Verify', schema: FINDINGS }),
  () => agent(`Spec/tone audit for /Users/gary/dev/pipskeep Phase 6 vs PIPSKEEP_SPEC.md sections 0, 3, 10, 10.1, 12, 15.5. (1) First-90-seconds copy vs 10.1 beat-by-beat (title, three intros, wave-goodbye 'they're fine' warmth, hungry prompt, explore prompt); flag flat copy. (2) Onboarding <= 60s plausible + skippable per spec. (3) Scope fence final sweep: grep for Web Push/Notification API (must be absent — notify() in-app only), sound() still a no-op seam or optional, no breeding UI, no seasonal content. (4) Vocabulary sweep of ALL user-facing strings incl. README + manifest (Pip/Pipling/Pipping/Keep used; zero forbidden terms). (5) Dialogue pools still >= 8 lines each post-dedupe, validation still hard-fails. (6) The two delight features: confirm they are cosmetic-only (parade makes zero dispatches; shiny affects no stats/rates) and discoverable-not-documented in README. (7) a11y labels present on all interactive controls. pass=true only if zero blocker/major.`, { label: 'audit:spec-tone', phase: 'Verify', schema: FINDINGS }),
  () => agent(`Mutation tester for /Users/gary/dev/pipskeep. Phase 6 work is UNCOMMITTED — copy targets to /tmp, restore + cmp after each cycle, NEVER git-restore. Mutations vs src (never tests): (1) onboarding.completed never set (guided beats replay every boot); (2) existing-save migration marks onboarding incomplete (veterans get onboarded); (3) starter trio not deterministic from seed (fresh rng); (4) shiny roll bypasses the egg stream (Math-random-equivalent via a fresh stream each call); (5) shiny lost on evolution; (6) parade controller given dispatch access + dispatching TICK (the no-dispatch-by-construction guarantee broken — if the type/construction genuinely prevents this, PROVE it by attempting the wiring and report KILLED-BY-CONSTRUCTION); (7) berry migration drops resource-berries instead of converting to inventory. For each: apply, npm test, FAILED (good) or SURVIVED (major + missing assertion), restore + cmp. Finish: suite green, git status only legit files.`, { label: 'audit:mutation', phase: 'Verify', schema: FINDINGS }),
])

const all = [gate, audit, mutation].filter(Boolean)
const majors = all.flatMap(r => r.findings).filter(f => f.severity !== 'minor')
const minors = all.flatMap(r => r.findings).filter(f => f.severity === 'minor')

phase('Fix')
let fixReport = null
let regate = null
if (majors.length > 0) {
  fixReport = await agent(`${SHARED}

Fix these Phase 6 findings (majors mandatory, minors if cheap): ${JSON.stringify(majors)} Minors: ${JSON.stringify(minors)}. End green: npm test + npm run build.`, { label: 'fixer', phase: 'Fix', schema: REPORT })
  regate = await agent(`In /Users/gary/dev/pipskeep: npm test + npm run build. Real output. pass=true only if fully green and git status shows only legitimate Phase 6 files.`, { label: 're-gate', phase: 'Fix', schema: FINDINGS })
} else {
  log('No blocker/major findings — Phase 6 verified clean')
}

return {
  onboarding: b1?.summary,
  pwaReadme: b2?.summary,
  polishDelight: b3?.summary,
  integration: integ?.summary,
  perf: b2?.perf ?? null,
  decisions: [b1, b2, b3, integ].filter(Boolean).flatMap(b => b.decisions ?? []),
  gatePass: (regate ?? gate)?.pass ?? false,
  majorsFixed: majors,
  minorsOutstanding: minors,
  fixReport: fixReport?.summary ?? null,
}