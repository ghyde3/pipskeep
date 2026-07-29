/**
 * Palette token tests (spec §11): every species/palette id in the species
 * registry resolves to full tokens, and unknown ids fall back instead of
 * crashing (a bad genome must never take down the renderer).
 */

import { describe, expect, it } from "vitest";
import { species } from "./species";
import {
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
