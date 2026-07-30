export const meta = {
  name: 'phase0-scaffold',
  description: 'Scaffold PipsKeep (Vite+TS strict+Pixi+Vitest), Clock/RNG/store/registries, then adversarially verify the Phase 0 gate',
  phases: [
    { title: 'Build', detail: 'one agent wires the full skeleton and gets tests+build green' },
    { title: 'Verify', detail: 'gate runner + spec/purity reviewer + test-quality reviewer, independently' },
    { title: 'Fix', detail: 'apply confirmed findings, re-run the gate' },
  ],
}

const REPORT = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    testsOk: { type: 'boolean' },
    buildOk: { type: 'boolean' },
    testOutput: { type: 'string', description: 'final vitest summary lines' },
    decisions: { type: 'array', items: { type: 'string' }, description: 'noteworthy implementation decisions' },
  },
  required: ['summary', 'testsOk', 'buildOk', 'testOutput'],
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

phase('Build')
const build = await agent(`You are the scaffold builder for PipsKeep at /Users/gary/dev/pipskeep.

Read CLAUDE.md and PIPSKEEP_SPEC.md sections 0, 1, 2, 3, and Phase 0 of section 13 FIRST. They are the contract.

Build the complete Phase 0 scaffold:

1. package.json (npm): deps EXACTLY pixi.js (v8 latest) + idb; devDeps EXACTLY vite, typescript, vitest. NOTHING else (no PWA plugin yet — that is Phase 6). Scripts: dev, build (tsc --noEmit && vite build), preview, test (vitest run), "test:watch".
2. tsconfig.json: strict true, noUncheckedIndexedAccess true, ES2022 target, bundler moduleResolution.
3. vite.config.ts: server port 5317, strictPort true. Vitest config (environment: 'node' for core tests).
4. Folder structure per spec section 2: src/core/ (clock.ts, rng.ts, store.ts, and empty-but-typed pips/, eggs/, expeditions/, keep/, economy/, save/ subfolders with index.ts stubs), src/content/, src/render/, src/ui/, src/app/.
5. src/core/clock.ts: Clock interface { now(): number }, SystemClock (the ONLY file in the repo allowed to call Date.now()), FakeClock with advance(ms) and set(t).
6. src/core/rng.ts: mulberry32 PRNG. API: createRng(seed) with .stream(name) returning a named stream (deterministic derivation from seed + name, e.g. seed XOR fnv1a(name)). Streams expose next() in [0,1), int(maxExclusive), pick(array), chance(p). CRITICAL: every stream's current 32-bit state is readable and restorable — getState(): Record<string, number> and createRngFromState(seed, state) — so cursors can live inside GameState and survive save/reload. No Math.random anywhere else in the repo.
7. src/core/store.ts: tiny typed store — createStore(reducer, initialState) with getState/dispatch/subscribe. One-way flow only.
8. src/content/: typed registry modules with minimal starter data: tuning.ts (ALL [DEFAULT — review] numeric values from spec sections 4-7: decay rates, personality multipliers, mood thresholds, sulk exit 25, offline cap 12h, care action effects and cooldowns, play refusal thresholds, expedition table, incubation 2h, roster cap 3, pipling 24h/x1.2, evolution 72h/avg70), species.ts (mosspip entry with evolution condition fields), foods.ts (berry +25, stew +50/+5), expeditions.ts (meadow/forest/shore per spec 6.1), personalities.ts (all five with multipliers from spec 4.2), dialogue.ts (typed structure keyed personality x context where context = beaming|content|grumpy|miserable|sulking|refusal — placeholder 1-2 lines each for now, Phase 2 fills them; export the REQUIRED_LINES_PER_CONTEXT = 8 constant and a validation that currently warns not errors for underfilled pools), keep.ts (levels 1-3 with resource-bundle costs per spec 6.3), decorations.ts (6 placeholder entries).
9. src/content/validate.ts: validateContent() run at boot in dev mode — broken evolution targets, empty loot tables, missing species refs, negative costs => loud console.error. Must have a unit test.
10. src/app/main.ts + index.html: bootstrap Pixi v8 (await app.init), soft pastel background (#f4ead5 or similar), mount canvas, run validateContent() in dev. Blank world is fine — it must build and run.
11. Tests (vitest, all under src/core or alongside): clock.test.ts (FakeClock advance exact ms), rng.test.ts (same seed => identical sequences; different stream names => different sequences; getState/createRngFromState round-trip => identical continuation; chance/int/pick determinism), store.test.ts (dispatch/subscribe/one-way), validate.test.ts.

Then: npm install, npm test, npm run build — iterate until BOTH are fully green. Do not commit. Do not touch PROGRESS.md, CLAUDE.md, or .claude/.

Purity rules you will be adversarially audited on: Date.now()/new Date() ONLY in clock.ts; Math.random ONLY in rng.ts (and ideally not even there — mulberry32 needs neither); no any without an inline justification comment; core/ imports nothing from render/ui/app or pixi.

Return the report with real test output pasted.`, { label: 'scaffold', schema: REPORT })

phase('Verify')
const [gate, specReview, testReview] = await parallel([
  () => agent(`In /Users/gary/dev/pipskeep run: npm test (capture summary), then npm run build (capture result). Then verify: dist/ exists with an index.html referencing built JS; vite.config.ts pins port 5317 with strictPort; package.json deps are EXACTLY pixi.js+idb and devDeps EXACTLY vite+typescript+vitest. You are a gate runner: report pass only if everything is green as-run by YOU, not as claimed by others. List every deviation as a finding.`, { label: 'gate-runner', phase: 'Verify', schema: FINDINGS }),
  () => agent(`Adversarial spec/purity audit of /Users/gary/dev/pipskeep against PIPSKEEP_SPEC.md sections 0, 1, 2, 3 (read them). Grep, do not trust reading: (1) 'Date.now\\|new Date(' outside src/core/clock.ts, (2) 'Math.random' outside src/core/rng.ts, (3) any pixi/DOM import inside src/core or src/content, (4) ': any' without an inline justification comment, (5) tsconfig strict true, (6) folder structure matches spec section 2 exactly, (7) content registries typed with a validation function wired to dev boot, (8) forbidden vocabulary (Pal, gotchi, pokemon, palworld, tamagotchi — case-insensitive) anywhere in src/ or index.html, (9) tuning values in content match the spec tables exactly (decay rates, personality multipliers, care effects). Report each violation as a finding with file+severity. pass=true only if zero blocker/major findings.`, { label: 'audit:spec-purity', phase: 'Verify', schema: FINDINGS }),
  () => agent(`Test-quality review of /Users/gary/dev/pipskeep. Read every *.test.ts. The Phase 0 gate (PIPSKEEP_SPEC.md section 13) requires: FakeClock advance test passes and RNG stream determinism test passes. Judge whether the tests PROVE this: exact-value assertions (not toBeGreaterThan), RNG state round-trip test that saves cursor state mid-sequence, restores into a fresh instance, and asserts the continuation is IDENTICAL element-by-element; stream independence; store one-way flow. Also: would these tests catch a mulberry32 implementation that ignores the seed? A FakeClock that drifts? Report gaps as findings. pass=true only if the gate is genuinely proven.`, { label: 'audit:test-quality', phase: 'Verify', schema: FINDINGS }),
])

const all = [gate, specReview, testReview].filter(Boolean)
const findings = all.flatMap(r => r.findings).filter(f => f.severity !== 'minor')
const minors = all.flatMap(r => r.findings).filter(f => f.severity === 'minor')

phase('Fix')
let fixReport = null
let regate = null
if (findings.length > 0) {
  fixReport = await agent(`Fix these confirmed audit findings in /Users/gary/dev/pipskeep (read CLAUDE.md + relevant spec sections first). Findings JSON: ${JSON.stringify(findings)}. Also apply these minor findings if cheap: ${JSON.stringify(minors)}. After fixing, run npm test and npm run build until green. Do not commit.`, { label: 'fixer', schema: REPORT })
  regate = await agent(`In /Users/gary/dev/pipskeep run npm test and npm run build. Report actual output. pass=true only if both fully green.`, { label: 're-gate', schema: FINDINGS })
} else {
  log('No blocker/major findings — skipping fix stage')
}

return {
  build,
  gatePass: (regate ?? gate)?.pass ?? false,
  findingsFixed: findings,
  minorsOutstanding: minors,
  fixReport,
}