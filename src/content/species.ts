/**
 * Species registry (spec §3): id, display name, base sprite variant params,
 * evolution conditions, rarity. Compound diminutive names per spec §0.
 */

export type SpeciesId = string;

export type Rarity = "common" | "uncommon" | "rare";

/** Base sprite variant params — consumed by the SpriteResolver (spec §11). */
export interface SpriteVariantParams {
  palettes: readonly string[];
  patterns: readonly string[];
  accessorySlots: number;
}

/** Evolution conditions (spec §4.6). Thresholds default from tuning.ts. */
export interface EvolutionDef {
  /** Species this one evolves into. Must exist in the registry. */
  targetSpeciesId: SpeciesId;
  /** Ready when ageMs ≥ this... */
  minAgeMs: number;
  /** ...AND happinessIntegral / ageMs ≥ this. */
  minLifetimeAvgHappiness: number;
  /**
   * Variant selection: most recent Give Item (`lastGiftItemId`) → variant.
   * Keys are item ids (validated against the food registry for now).
   */
  giftVariants: Readonly<Record<string, string>>;
  /** Used when the Pip never received a gift. */
  defaultVariantId: string;
}

export interface SpeciesDef {
  id: SpeciesId;
  name: string;
  rarity: Rarity;
  sprite: SpriteVariantParams;
  /** Absent = this species does not evolve. */
  evolution?: EvolutionDef;
}

import { tuning } from "./tuning";

export const species: Readonly<Record<SpeciesId, SpeciesDef>> = {
  mosspip: {
    id: "mosspip",
    name: "Mosspip",
    rarity: "common",
    sprite: {
      palettes: ["fern", "lichen", "clover"],
      patterns: ["plain", "speckled", "swirl"],
      accessorySlots: 1,
    },
    evolution: {
      targetSpeciesId: "grovepip",
      minAgeMs: tuning.evolution.minAgeMs,
      minLifetimeAvgHappiness: tuning.evolution.minLifetimeAvgHappiness,
      giftVariants: {
        berry: "berrybright",
        stew: "heartymoss",
      },
      defaultVariantId: "verdant",
    },
  },
  // Evolved form of the starter species (spec §4.6 — MVP: one evolved form).
  grovepip: {
    id: "grovepip",
    name: "Grovepip",
    rarity: "uncommon",
    sprite: {
      palettes: ["fern", "lichen", "clover"],
      patterns: ["plain", "speckled", "swirl"],
      accessorySlots: 2,
    },
  },
};
