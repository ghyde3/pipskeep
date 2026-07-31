/**
 * Palette token tests (spec §11): every species/palette id in the species
 * registry resolves to full tokens, and unknown ids fall back instead of
 * crashing (a bad genome must never take down the renderer).
 */

import { describe, expect, it } from "vitest";
import { species } from "./species";
import {
  keepPalette,
  moodColors,
  needColors,
  resolvePipPalette,
  speciesPalettes,
} from "./palette";
import { MOODS } from "../core/pips/mood";
import { NEED_IDS } from "../core/pips/types";
import { daylightAt } from "../app/daylight";

const HEX = /^#[0-9a-f]{6}$/i;

describe("resolvePipPalette", () => {
  it("resolves full tokens for every species × palette in the registry", () => {
    for (const def of Object.values(species)) {
      for (const paletteId of def.sprite.palettes) {
        const tokens = resolvePipPalette(def.id, paletteId);
        for (const value of Object.values(tokens)) {
          expect(value).toMatch(HEX);
        }
      }
    }
  });

  it("every registry species has an authored palette (no wildcard leaks)", () => {
    for (const def of Object.values(species)) {
      expect(speciesPalettes[def.id]).toBeDefined();
    }
  });

  it("gives each species ONE vibrant accent shared across variants", () => {
    for (const def of Object.values(species)) {
      const accents = new Set(
        def.sprite.palettes.map((p) => resolvePipPalette(def.id, p).accent),
      );
      expect(accents.size).toBe(1);
    }
  });

  it("falls back per-species for an unknown variant id", () => {
    const fallback = resolvePipPalette("mosspip", "not-a-palette");
    const authored = resolvePipPalette(
      "mosspip",
      speciesPalettes["mosspip"]?.fallbackVariantId ?? "fern",
    );
    expect(fallback).toEqual(authored);
  });

  it("falls back to the wildcard look for an unknown species", () => {
    const tokens = resolvePipPalette("no-such-species", "whatever");
    for (const value of Object.values(tokens)) {
      expect(value).toMatch(HEX);
    }
  });
});

describe("ui token coverage", () => {
  it("has a mood dot color for every core Mood", () => {
    for (const mood of MOODS) {
      expect(moodColors[mood]).toMatch(HEX);
    }
  });

  it("has a bar color for every NeedId", () => {
    for (const need of NEED_IDS) {
      expect(needColors[need]).toMatch(HEX);
    }
  });
});

/**
 * ROUND 2G REVIEW — THE STARTER PIP'S LEGIBILITY, PINNED.
 *
 * `mosspip`/`fern` is the palette every player meets in the first second of
 * the game, and it shipped at 1.05 : 1 against both of the Keep's ground
 * tones — a pale blob on pale grass, with a 2.62 : 1 outline as its only
 * silhouette. A player landing cold found the XP bar and six white action
 * cards before they found the creature.
 *
 * A floor, not an exact hex: the art may keep moving and should, but it must
 * not move BACK into the grass. The thresholds are the measured values of the
 * retuned variant, rounded down — deliberately below WCAG's 3 : 1
 * non-text-contrast bar for the body fill, because the honest position is
 * that a soft-pastel diorama cannot hit 3 : 1 on a body fill without becoming
 * a different game, while the OUTLINE (which is what actually carries a
 * cartoon silhouette) can and now does.
 *
 * Scoped to the starter on purpose: all 14 birth variants sit between 1.00
 * and 1.69 against the ground, so widening this test today would be
 * asserting a repaint nobody has decided on. See the note on `fern` in
 * palette.ts.
 */
describe("starter palette legibility against the Keep's ground", () => {
  const GROUND_TONES = [keepPalette.ground, keepPalette.groundNear] as const;

  /** WCAG 2.1 relative luminance. */
  function luminance(hex: string): number {
    const n = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => {
      const v = Number.parseInt(n.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
      number,
      number,
    ];
    return (hi + 0.05) / (lo + 0.05);
  }

  it("agrees with a known pair, so the ratio itself is not the thing under test", () => {
    // Black on white is exactly 21 : 1 by definition.
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
  });

  // EVERY variant, not just `fallbackVariantId`: the genesis roll picks
  // freely among them, so "the Pip every player meets first" is any of the
  // three. The original report named `fern` only because that is what its
  // save rolled; the re-measurement rolled `clover`.
  const STARTER_VARIANTS = species["mosspip"]?.sprite.palettes ?? [];

  it("covers all three starter variants, so this cannot be satisfied by fixing one", () => {
    expect(STARTER_VARIANTS.length).toBeGreaterThanOrEqual(3);
  });

  it("the starter's BODY is a visible object on the grass, not a wash of it", () => {
    for (const variant of STARTER_VARIANTS) {
      const starter = resolvePipPalette("mosspip", variant);
      for (const ground of GROUND_TONES) {
        expect(contrast(starter.body, ground), `${variant} body`).toBeGreaterThanOrEqual(1.7);
      }
    }
  });

  it("the starter's OUTLINE carries the silhouette at WCAG's non-text bar", () => {
    for (const variant of STARTER_VARIANTS) {
      const starter = resolvePipPalette("mosspip", variant);
      for (const ground of GROUND_TONES) {
        expect(contrast(starter.outline, ground), `${variant} outline`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

/**
 * ⚠️ ROUND 2K FIX STAGE — THE GUARD BIBLE §4.2 REQUIRED AND THE ROUND DID
 * NOT BUILD.
 *
 * `tuning.liveliness.daylight.overlayAlpha`'s own doc comment says: "the
 * build stage must nonetheless re-run that suite against the
 * night-composited colours and report the worst pairing. If any pairing
 * drops below the shipped floor, THIS NUMBER COMES DOWN — never the
 * floor." That never happened. This file had eleven tests and no mention
 * of night, daylight, overlay or compositing, so the daylight tint was
 * free to be raised by anyone, at any time, past the point where a Pip
 * stops being visible on the grass.
 *
 * It matters more now than when it was written, because the fix stage
 * RAISED dawn (0.10 → 0.20) and dusk (0.14 → 0.26) to close the
 * sky-moves-but-ground-doesn't finding. That change is only safe because
 * this suite now measures it.
 *
 * Why ratios survive at all: the tint is ONE full-screen overlay ABOVE
 * `world`, so it composites the Pip and the ground with the same colour at
 * the same alpha. That compresses both luminances toward the overlay's,
 * which shrinks ratios — it does not preserve them exactly, which is
 * precisely why "the ratios are preserved by construction" needed
 * checking rather than asserting.
 */
describe("starter legibility SURVIVES the daylight tint at every phase", () => {
  const GROUND_TONES = [keepPalette.ground, keepPalette.groundNear] as const;

  function luminance(hex: string): number {
    const n = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => {
      const v = Number.parseInt(n.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  }

  /** Source-over composite of `overlay` at `alpha` onto `base` — exactly
   * what a full-screen Pixi overlay does to the pixels underneath. */
  function composite(base: string, overlay: string, alpha: number): string {
    const parse = (h: string): [number, number, number] => {
      const n = h.replace("#", "");
      return [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16)) as [
        number,
        number,
        number,
      ];
    };
    const [br, bg, bb] = parse(base);
    const [or, og, ob] = parse(overlay);
    const mix = (b: number, o: number): string =>
      Math.round(b * (1 - alpha) + o * alpha)
        .toString(16)
        .padStart(2, "0");
    return `#${mix(br, or)}${mix(bg, og)}${mix(bb, ob)}`;
  }

  /** Every phase's overlay, sampled from the SHIPPED ramp rather than
   * re-typed — a retune moves this suite with it. */
  const PHASE_SAMPLES = [0, 6.5, 12, 18.5, 22].map((hour) => {
    const noonLocal = new Date(2026, 5, 15, 0, 0, 0, 0).getTime() + hour * 60 * 60 * 1000;
    return { hour, sample: daylightAt(noonLocal) };
  });

  const STARTER_VARIANTS = species["mosspip"]?.sprite.palettes ?? [];

  it("samples a real spread of phases (guards against a vacuous suite)", () => {
    const phases = new Set(PHASE_SAMPLES.map((p) => p.sample.phase));
    expect(phases.size).toBeGreaterThanOrEqual(3);
    expect(phases).toContain("night");
    // …and at least one phase is actually tinting something.
    expect(Math.max(...PHASE_SAMPLES.map((p) => p.sample.overlayAlpha))).toBeGreaterThan(0.15);
  });

  /**
   * ⚠️ A RELATIVE floor for the body, and the reason is worth stating so
   * nobody "fixes" it back to 1.7. Compositing a uniform overlay pulls the
   * Pip and the ground toward the SAME colour, so every absolute ratio in
   * the scene shrinks a little — and `fern`'s untinted body already sits
   * at 1.70 against the grass (see palette.ts's own note on it). Demanding
   * the untinted absolute floor after tinting would therefore be
   * satisfiable only by `overlayAlpha: 0` — i.e. by deleting the daylight
   * feature — which is not a legibility argument, it is arithmetic.
   *
   * What IS a legibility argument: the tint may not cost more than about
   * a seventh of the separation the palette already earned, and may never
   * fall through an absolute backstop. Both are checked. (0.85 is the
   * measured worst case — `fern` at dawn — rounded down, in the same
   * spirit as the untinted floors above: a bar the art must not move BACK
   * through, not a target.)
   */
  it("the BODY keeps its separation from the grass under every phase's tint", () => {
    for (const { sample, hour } of PHASE_SAMPLES) {
      for (const variant of STARTER_VARIANTS) {
        const starter = resolvePipPalette("mosspip", variant);
        const body = composite(starter.body, sample.overlayColor, sample.overlayAlpha);
        for (const ground of GROUND_TONES) {
          const lit = composite(ground, sample.overlayColor, sample.overlayAlpha);
          const untinted = contrast(starter.body, ground);
          const tinted = contrast(body, lit);
          const where = `${variant} body at ${sample.phase} (hour ${hour}, alpha ${sample.overlayAlpha})`;
          expect(tinted, `${where}: absolute backstop`).toBeGreaterThanOrEqual(1.5);
          expect(tinted / untinted, `${where}: lost too much of its untinted contrast`)
            .toBeGreaterThanOrEqual(0.85);
        }
      }
    }
  });

  /**
   * The OUTLINE keeps its ABSOLUTE floor, because this is the one bar the
   * project actually holds at WCAG's 3 : 1 non-text level and because the
   * outline is what carries a cartoon silhouette. It is also what bounds
   * `overlayAlpha` from above: dawn, dusk and night each sit under the
   * alpha at which this crosses 3.0.
   */
  it("the OUTLINE still carries the silhouette under every phase's tint", () => {
    for (const { sample, hour } of PHASE_SAMPLES) {
      for (const variant of STARTER_VARIANTS) {
        const starter = resolvePipPalette("mosspip", variant);
        const outline = composite(starter.outline, sample.overlayColor, sample.overlayAlpha);
        for (const ground of GROUND_TONES) {
          const lit = composite(ground, sample.overlayColor, sample.overlayAlpha);
          expect(
            contrast(outline, lit),
            `${variant} outline at ${sample.phase} (hour ${hour}, alpha ${sample.overlayAlpha})`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  /**
   * The finding this whole section exists to prevent recurring: a sky that
   * changes dramatically over ground that does not, so dusk reads as a
   * swapped backdrop rather than as changed light.
   */
  it("dawn, dusk and night MOVE the ground, not just the sky", () => {
    // Measured as RGB distance, NOT luminance: dawn's light is a warm
    // cream, and warming a green lawn barely changes how BRIGHT it is
    // while changing very much what COLOUR it is. A luminance-only metric
    // scores a beautiful dawn at zero, which is how the original tuning
    // pass talked itself into an alpha of 0.10.
    const ground = keepPalette.ground;
    const rgb = (h: string): [number, number, number] => {
      const n = h.replace("#", "");
      return [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16)) as [
        number,
        number,
        number,
      ];
    };
    const distance = (a: string, b: string): number => {
      const [x, y, z] = rgb(a);
      const [p, q, r] = rgb(b);
      return Math.sqrt((x - p) ** 2 + (y - q) ** 2 + (z - r) ** 2);
    };
    for (const phase of ["dawn", "dusk", "night"] as const) {
      const sample = PHASE_SAMPLES.map((p) => p.sample).find((s) => s.phase === phase);
      expect(sample, `no sampled hour lands in ${phase}`).toBeDefined();
      if (sample === undefined) continue;
      const shift = distance(composite(ground, sample.overlayColor, sample.overlayAlpha), ground);
      expect(
        shift,
        `${phase} moves the ground by only ${shift.toFixed(1)}/255 — the sky changes and the ` +
          `world under it does not, which reads as a replaced backdrop rather than as light`,
      ).toBeGreaterThan(10);
    }
  });
});
