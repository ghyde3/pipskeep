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
