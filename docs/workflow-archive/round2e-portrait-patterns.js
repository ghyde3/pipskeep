export const meta = {
  name: 'round2e-portrait-patterns',
  description: 'Author the 11 missing DOM portrait pattern overlays so pips render fully in the focus view and the Album, matching the Pixi scene',
  phases: [
    { title: 'Author', detail: 'write the missing overlays in both stylesheets, matching the resolver' },
    { title: 'Verify', detail: 'visual sweep of all 14 forms + parity gate' },
    { title: 'Fix', detail: 'apply findings' },
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

const CONTEXT = `Project: /Users/gary/dev/pipskeep (1553 tests, round 2C just committed as b60d7c1). Read CLAUDE.md first.

THE BUG, already diagnosed by the orchestrator — do not re-diagnose, fix it:
A pip's pattern is drawn by THREE independent implementations:
  1. src/render/spriteResolver.ts — the Pixi scene. THIS IS THE VISUAL SOURCE OF TRUTH. It draws real shapes (a spiral polyline for swirl, dots, bands, etc.) and handles all 9 content patterns.
  2. src/ui/ui.css — the focus-view DOM portrait, rules named \`.pk-portrait-blob--<pattern>\`.
  3. src/ui/pipdex.css — the Album's DOM portrait, rules named \`.pk-pipdex-blob--pattern-<pattern>\`.

Round 2B added six new pattern primitives (banded, ripple, ember, flake, puff, glowdot) to the resolver and to content/species.ts but NEVER added them to either stylesheet. \`speckled\` is also missing from pipdex.css. So most pips currently render with NO pattern overlay in the focus view and in the Album — the owner reported this as the Album looking "not fully rendered".

EXACTLY WHAT IS MISSING (from the failing parity test, src/ui/portraitPatterns.test.ts):
- ui.css needs: banded, ember, flake, glowdot, puff, ripple
- pipdex.css needs: ember, flake, glowdot, puff, speckled
(\`plain\` correctly has no rule. \`swirl\` and the rest already exist.)

THE TEST IS THE SPEC. src/ui/portraitPatterns.test.ts currently FAILS with 11 failures. Your job is to make it pass by authoring real overlays — NOT by weakening or deleting the test. It also asserts that no stylesheet uses \`repeating-conic-gradient\`, because a full-body radially-repeating gradient renders as a STARBURST across the pip's face; that was the other half of this bug and the orchestrator already fixed \`swirl\` in both files. Use those two fixed \`swirl\` rules as your reference for style, scale and the bounded/off-center approach.

RULES:
- Each overlay must READ AS THE SAME MOTIF the Pixi resolver draws for that pattern id. Go read each branch in spriteResolver.ts (search for \`kind === \` and the patternKind switch) and match its intent: a pip should not look like a different creature in the Keep than in its own portrait.
- Pure CSS. No new dependencies, no image assets, no data-URI SVG blobs.
- Use \`var(--pk-pattern, <fallback>)\` for colour, exactly as the existing rules do (the pattern colour is set inline per pip).
- Overlays must be BOUNDED and subtle: never cover the eyes/blush, never radiate across the whole body, and stay legible at BOTH sizes (the focus-view portrait is ~116px, the Album's is much smaller).
- Keep the two stylesheets visually consistent with each other for the same pattern.
- Do not touch src/render/, core/, or any .ts file other than the test if it genuinely needs a fix (it should not).
- npm test and npm run build must be green when you finish. Do not commit.`

phase('Author')
const author = await agent(`${CONTEXT}

Author all 11 missing pattern overlays.

Process:
1. Read src/render/spriteResolver.ts's pattern branches first and write down, per pattern, what the scene actually draws (shape, count, placement, weight). Put that summary in your report — it is how the reviewer will judge fidelity.
2. Read the existing \`swirl\` rules in both stylesheets (the orchestrator's reference fix) plus the existing dots/stripes/banded/ripple rules already present, so your new rules match the house style.
3. Author the missing rules in both files.
4. Run \`npx vitest run src/ui/portraitPatterns.test.ts\` until all 18 assertions pass, then the full \`npm test\` and \`npm run build\`.
5. VERIFY VISUALLY — this is a visual bug and tests cannot see it. Start the dev server (port 5317 is pinned; kill any stale vite first and note that .claude/launch.json sets autoPort:false deliberately). Build a temporary in-page harness or use the debug menu's save import to render every one of the 9 patterns in BOTH the focus-view portrait and the Album portrait, at mobile (375px) and desktop. Confirm each pattern is visible, on-motif, does not cover the face, and matches its Pixi counterpart. REMOVE any harness afterwards. Report per-pattern what you actually saw at both sizes.`, { label: 'author:patterns', phase: 'Author', schema: REPORT, model: 'sonnet' })

phase('Verify')
const [gate, visual] = await parallel([
  () => agent(`Gate runner for /Users/gary/dev/pipskeep round 2E. Run \`npm test\` and \`npm run build\` YOURSELF. Verify: (1) src/ui/portraitPatterns.test.ts passes ALL assertions and has NOT been weakened — diff it against git HEAD and report any change to the test file itself as a MAJOR finding (the test is the spec; making it pass by editing it is cheating); (2) every one of the 9 content patterns in content/species.ts now has a rule in BOTH ui.css and pipdex.css; (3) neither stylesheet contains repeating-conic-gradient outside comments; (4) no .ts source file outside tests changed (git diff --stat) — this was a CSS-only round; (5) full suite green and build clean. pass=true only on evidence you gathered yourself.`, { label: 'gate-runner', phase: 'Verify', schema: FINDINGS, model: 'sonnet' }),
  () => agent(`VISUAL FIDELITY REVIEW for /Users/gary/dev/pipskeep round 2E. The whole point of this round is that pips render correctly, which only eyes can confirm.

Read src/render/spriteResolver.ts's pattern branches to learn what each of the 9 patterns SHOULD look like. Then start the dev server (port 5317, kill stale vite first) and render pips with every pattern in both the focus-view portrait and the Album, at 375px and desktop — use the debug menu (Spawn egg, Import save) or your own temporary harness, and clean up anything you add.

Judge and report findings for: any pattern that is INVISIBLE at either size; any pattern that covers the eyes, blush or mouth; any pattern that reads as a different motif than the Pixi scene draws (a pip must not look like a different creature in its portrait than in the Keep); any pattern that is so strong it overwhelms the palette; and any visible difference between the focus-view and Album rendering of the SAME pattern. Include what you saw per pattern, at both sizes. pass=true only if all 9 patterns read correctly in both surfaces at both sizes.`, { label: 'audit:visual-fidelity', phase: 'Verify', schema: FINDINGS }),
])

const all = [gate, visual].filter(Boolean)
const majors = all.flatMap(r => r.findings).filter(f => f.severity !== 'minor')
const minors = all.flatMap(r => r.findings).filter(f => f.severity === 'minor')

phase('Fix')
let fixReport = null
let regate = null
if (majors.length > 0) {
  fixReport = await agent(`${CONTEXT}

Fix these round-2E findings (majors mandatory, minors if cheap): ${JSON.stringify(majors)} Minors: ${JSON.stringify(minors)}. Visual-fidelity findings are the POINT of this round — rework the CSS until the motif reads correctly, and re-verify in the browser at both sizes. Never satisfy a finding by weakening src/ui/portraitPatterns.test.ts. End green: npm test + npm run build.`, { label: 'fixer', phase: 'Fix', schema: REPORT, model: 'sonnet' })
  regate = await agent(`In /Users/gary/dev/pipskeep: run npm test + npm run build, and confirm src/ui/portraitPatterns.test.ts is unchanged from git HEAD except for legitimate fixes. Report real output. pass=true only if fully green.`, { label: 're-gate', phase: 'Fix', schema: FINDINGS, model: 'sonnet' })
} else {
  log('No blocker/major findings — round 2E verified clean')
}

return {
  author: author?.summary,
  decisions: author?.decisions ?? [],
  gatePass: (regate ?? gate)?.pass ?? false,
  visualVerdict: visual?.notes,
  majorsFixed: majors,
  minorsOutstanding: minors,
  fixReport: fixReport?.summary ?? null,
}