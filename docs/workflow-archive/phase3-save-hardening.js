export const meta = {
  name: 'phase3-save-hardening',
  description: 'Corrupt-save recovery flow, dev debug menu with time-skip clock, autosave hardening — spec section 8 + 14',
  phases: [
    { title: 'Build', detail: 'recovery flow, then debug menu + offset clock' },
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

const SHARED = `Project: /Users/gary/dev/pipskeep. Read CLAUDE.md, then PIPSKEEP_SPEC.md sections 8, 13 Phase 3, and 14 (debug menu). Existing: src/core/save/ (serialize with never-throw fromSaveBlob returning typed errors, migrate harness with v1 fixture), src/app/persistence.ts (initPersistence: idb-backed, 2s debounced autosave, hidden-flush, injectable SaveStore/TimerHost/VisibilityHost), src/app/main.ts boot flow, working game on port 5317. Purity rules as ever. npm test + npm run build green before finishing. Do not commit; do not touch PROGRESS.md/.claude/.`

phase('Build')
const b1 = await agent(`${SHARED}

You own the corrupt-save recovery flow (spec 8: "Load failure (corrupt/unmigratable): offer Start Fresh with the broken blob exported to a downloadable file — never silently wipe").

1. Persistence: when the stored blob fails migrate/fromSaveBlob, loadPipskeep must return { loadError, rawBlob } (keep the raw bytes/JSON). Before ANY overwrite of a corrupt save, stash the broken blob under a separate idb key (quarantine-<timestamp>) — starting fresh must never destroy the evidence.
2. src/ui/recovery.ts: a warm, on-tone modal (never scary): headline like "Your save file got a bit scrambled." Two actions: "Download broken save" (JSON file download of the raw blob) and "Start Fresh" (creates new game ONLY on explicit click). No third path; dismissing is not possible (the game cannot proceed without a decision). Show a one-line reassurance that the broken file was also kept safe.
3. Wire into src/app/main.ts boot: loadError -> show recovery modal instead of silently creating a new game (TODAY main.ts falls through to createNewGame on missing OR broken save — split those paths: missing = fresh start, broken = recovery modal).
4. Tests: corrupt JSON in the store -> load returns loadError + raw preserved; quarantine happens before overwrite; fresh start only after explicit choice (logic-level tests with the injectable SaveStore; DOM modal can be smoke-tested via jsdom if cheap, else keep modal logic in a pure controller function and test that).`, { label: 'build:recovery', phase: 'Build', schema: REPORT })

const b2 = await agent(`${SHARED}

Recovery builder finished: ${JSON.stringify(b1?.summary ?? 'inspect the repo')}. You own the debug menu + offset clock (spec 14: dev builds only — FakeClock time-skip buttons +1h +6h +24h, grant resources, export/import save; egg spawn arrives in Phase 4, leave a clearly-marked seam).

1. src/app/appClock.ts: OffsetClock wrapping SystemClock — now() = system + offsetMs, skew(ms) adds offset. Make ALL app-layer time flow through ONE shared instance (ticker TICK 'at', action timestamps, persistence savedAt — audit src/app + src/ui for direct SystemClock use and route through it). Core stays pure (it already takes timestamps).
2. src/ui/debugMenu.ts, gated by import.meta.env.DEV (verify it is tree-shaken from prod: npm run build then grep dist for a debug-only marker string — put the check in your report): toggle with backquote key or a tiny wrench button. Contents: +1h/+6h/+24h buttons (skew the OffsetClock then dispatch TICK so decay applies immediately — this is how QA fast-forwards expeditions/eggs in later phases); grant 5 Berries / 1 Stew / 10 of each resource; Export save (download current SaveBlob as pipskeep-save.json); Import save (file input -> migrate -> validate -> replace state and re-init — reject invalid with the typed error shown in a toast, never crash); "Corrupt my save" button (writes garbage to the store then offers reload — the QA path for the recovery flow); current clock offset display.
3. Tests: OffsetClock math; skew->TICK integration produces exactly the skewed decay via FakeClock-style assertions (you can compose OffsetClock over FakeClock in tests); import path rejects invalid blobs with typed errors and accepts a valid round-trip; grant actions produce exact inventory deltas.
4. Autosave hardening: add pagehide flush alongside visibilitychange (Safari), and a test that a dispatch followed by 2000ms flushes (exists) plus dispatch followed by hidden at 500ms flushes immediately (may exist — verify, strengthen if weak). The Phase 3 gate claim is "kill-tab-mid-session loses <= 2s of actions" — make the debounce + hidden/pagehide flush provably deliver that.`, { label: 'build:debug-menu', phase: 'Build', schema: REPORT })

phase('Verify')
const [gate, audit, mutation] = await parallel([
  () => agent(`Gate runner for /Users/gary/dev/pipskeep Phase 3 (spec 13). Run npm test + npm run build YOURSELF. Map gate clauses to named passing tests: (1) migration fixture test passes (src/core/save fixtures); (2) kill-tab loses <= 2s: debounce flush at 2000ms + immediate flush on hidden AND pagehide, all tested; (3) corrupt blob triggers recovery flow not a wipe: loadError path tested, quarantine-before-overwrite tested, fresh start only on explicit action; (4) export/import round-trip tested with invalid-blob rejection. Also verify the debug menu is ABSENT from the production bundle (build, then grep dist/assets/*.js for a debug-menu marker like 'Corrupt my save' or 'debug' UI strings — its presence in prod = major). pass only on full evidence.`, { label: 'gate-runner', phase: 'Verify', schema: FINDINGS }),
  () => agent(`Spec/tone audit for /Users/gary/dev/pipskeep Phase 3 against PIPSKEEP_SPEC.md sections 8 + 14 + 15.5 (read first). (1) Section 8 letter-by-letter: IndexedDB only (grep repo for localStorage — any hit is a blocker), save shape, migrations harness, autosave on state-mutating actions debounced 2s + visibilitychange, load-failure recovery with downloadable blob + never silently wipe. (2) Recovery modal copy: warm, mischievous-ok, never scary or guilt-heavy; flag corporate-error-speak. (3) Debug menu: dev-only gating pattern actually tree-shakes (import.meta.env.DEV usage correct — a runtime if inside an always-imported module that still ships strings = finding); egg-spawn seam marked for Phase 4. (4) OffsetClock: confirm src/app and src/ui have NO remaining direct SystemClock/Date.now use outside appClock.ts + clock.ts (grep). (5) Purity re-grep of core/. pass=true only if zero blocker/major.`, { label: 'audit:spec-tone', phase: 'Verify', schema: FINDINGS }),
  () => agent(`Mutation tester for /Users/gary/dev/pipskeep. Phase 3 work is UNCOMMITTED — copy each target file to /tmp before mutating, restore after each run, verify with cmp (never git-restore uncommitted work). Mutations vs src (never tests): (1) autosave debounce 2000 -> 20000; (2) remove the hidden/pagehide immediate flush; (3) recovery path silently calls createNewGame on corrupt blob (the historical bug the spec forbids); (4) skip quarantine before overwrite; (5) import path skips migrate() validation; (6) OffsetClock.skew is ignored by TICK dispatch; (7) export writes state without rngState. For each: apply, npm test, FAILED (good) or SURVIVED (major + name the missing assertion), restore + cmp. Finish: full suite green, git status shows only legit Phase 3 files.`, { label: 'audit:mutation', phase: 'Verify', schema: FINDINGS }),
])

const all = [gate, audit, mutation].filter(Boolean)
const majors = all.flatMap(r => r.findings).filter(f => f.severity !== 'minor')
const minors = all.flatMap(r => r.findings).filter(f => f.severity === 'minor')

phase('Fix')
let fixReport = null
let regate = null
if (majors.length > 0) {
  fixReport = await agent(`${SHARED}

Fix these Phase 3 findings (majors mandatory, minors if cheap): ${JSON.stringify(majors)} Minors: ${JSON.stringify(minors)}. End green: npm test + npm run build.`, { label: 'fixer', phase: 'Fix', schema: REPORT })
  regate = await agent(`In /Users/gary/dev/pipskeep: npm test + npm run build, confirm debug-menu strings absent from dist. Real output. pass=true only if fully green.`, { label: 're-gate', phase: 'Fix', schema: FINDINGS })
} else {
  log('No blocker/major findings — Phase 3 verified clean')
}

return {
  recovery: b1?.summary,
  debugMenu: b2?.summary,
  decisions: [b1, b2].filter(Boolean).flatMap(b => b.decisions ?? []),
  gatePass: (regate ?? gate)?.pass ?? false,
  majorsFixed: majors,
  minorsOutstanding: minors,
  fixReport: fixReport?.summary ?? null,
}