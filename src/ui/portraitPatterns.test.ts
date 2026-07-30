/**
 * PATTERN PARITY GUARD.
 *
 * A pip's pattern is drawn THREE separate times by three unrelated
 * implementations: the Pixi scene (render/spriteResolver.ts, a real
 * spiral/dot/band drawing), the focus-view DOM portrait (ui.css
 * `.pk-portrait-blob--<pattern>`), and the Album's DOM portrait
 * (pipdex.css `.pk-pipdex-blob--pattern-<pattern>`).
 *
 * That triplication is how they drifted: `swirl` shipped as a real spiral in
 * the scene but as a full-body `repeating-conic-gradient` in BOTH stylesheets,
 * which renders as a STARBURST across the pip's face — reported by the owner
 * in the Album and visible in the focus view too. Round 2B also added six new
 * pattern primitives, any of which could have been added to the resolver and
 * silently forgotten in one or both stylesheets.
 *
 * These tests cannot judge whether a pattern looks *right* — that needs eyes.
 * What they can do is make a MISSING or ORPHANED implementation impossible, so
 * a new content pattern can never render as a blank portrait in one surface
 * while looking fine in another.
 */

import { describe, expect, it } from "vitest";
import { species } from "../content/species";
import { albumPatternClassSuffix } from "./pipdex";
// `?raw` (declared by vite/client, already in tsconfig's "types") loads the
// file as a plain string through Vite/Vitest's own pipeline — no Node `fs`
// needed, so this stays inside the project's dependency allowlist (no
// `@types/node`, CLAUDE.md rule #2).
import uiCss from "./ui.css?raw";
import pipdexCss from "./pipdex.css?raw";

/** Declarations only. Without this, the starburst check below matches the
 * comment that EXPLAINS the starburst bug and fails on its own docs. */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every pattern id any species can actually roll (content is the source of
 * truth — a pattern nothing uses does not need a portrait rule). */
const contentPatterns = [
  ...new Set(Object.values(species).flatMap((s) => s.sprite.patterns)),
].sort();

/** "plain" is the deliberate no-overlay case: no rule is correct for it. */
const patternsNeedingOverlay = contentPatterns.filter((p) => p !== "plain");

describe("portrait pattern parity across the three implementations", () => {
  it("content actually declares patterns to check (guards against a vacuous suite)", () => {
    expect(patternsNeedingOverlay.length).toBeGreaterThan(3);
  });

  it.each(patternsNeedingOverlay)(
    "focus-view portrait (ui.css) draws '%s'",
    (pattern) => {
      expect(uiCss).toContain(`.pk-portrait-blob--${pattern}`);
    },
  );

  it.each(patternsNeedingOverlay)(
    "Album portrait (pipdex.css) draws '%s'",
    (pattern) => {
      expect(pipdexCss).toContain(`.pk-pipdex-blob--pattern-${pattern}`);
    },
  );

  // An authored rule is worthless if the TypeScript never emits its class.
  // The Album previously bucketed ember/flake/puff/glowdot into one shared
  // "fleck" class, which silently discarded four dedicated rules — four
  // species wore identical dots in the Album while looking distinct in the
  // Keep. CSS-exists and TS-emits-it are separate acceptance criteria
  // (spec §16 v1.3's standing rule), so assert both.
  it.each(patternsNeedingOverlay)(
    "the Album emits a class that EXISTS for '%s'",
    (pattern) => {
      const suffix = albumPatternClassSuffix(pattern);
      expect(
        pipdexCss,
        `'${pattern}' emits '.pk-pipdex-blob--pattern-${suffix}', which has no rule`,
      ).toContain(`.pk-pipdex-blob--pattern-${suffix}`);
    },
  );

  // Injectivity is the real guard. A pure alias is fine (`speckled` and
  // `dots` are the same motif, aliased the same way in spriteResolver.ts),
  // but two DISTINCT motifs sharing one class is the bug that shipped: four
  // species wore identical dots in the Album while looking distinct in the
  // Keep.
  it("no two distinct content patterns collapse to the same Album class", () => {
    const byClass = new Map<string, string[]>();
    for (const pattern of patternsNeedingOverlay) {
      const suffix = albumPatternClassSuffix(pattern);
      byClass.set(suffix, [...(byClass.get(suffix) ?? []), pattern]);
    }
    const collisions = [...byClass.entries()].filter(([, ps]) => ps.length > 1);
    expect(collisions, `collapsed: ${JSON.stringify(collisions)}`).toEqual([]);
  });

  // The specific regression: a pattern overlay spanning the WHOLE blob with
  // radial repetition reads as a starburst over the face. `swirl` is one
  // small curl on the upper flank in the Pixi resolver, and both DOM
  // portraits must agree.
  it("no portrait pattern uses a full-body repeating-conic-gradient (the starburst bug)", () => {
    for (const [name, css] of [
      ["ui.css", stripComments(uiCss)],
      ["pipdex.css", stripComments(pipdexCss)],
    ] as const) {
      expect(
        css.includes("repeating-conic-gradient"),
        `${name} still uses repeating-conic-gradient — that renders as a starburst across the pip's face; use a bounded, off-center motif instead`,
      ).toBe(false);
    }
  });
});
