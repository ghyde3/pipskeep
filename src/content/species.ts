/**
 * Species registry (spec §3): id, display name, base sprite variant params,
 * evolution conditions, rarity. Compound diminutive names per spec §0.
 *
 * ROUND 2B CONTENT EXPANSION (content-bible §1): seven lines, fourteen
 * forms. Mosspip/Grovepip are the shipped starter line — kept, not
 * rewritten (two additive edits: mosspip's `honeydrop` gift key, §1.7; and
 * grovepip's rarity fix, §1.2/§1.6 below). Six new lines are added whole:
 * Pebblepip→Cairnpip, Tidepip→Reefpip, Emberpip→Hearthpip, Snowpip→Frostpip,
 * Cloudpip→Thunderpip, Lanternpip→Beaconpip.
 *
 * Every species is identifiable at a glance on three independent axes
 * (content-bible §1.1): biome affinity (which expedition's egg pool it
 * hatches from — content/expeditions.ts + core, not this file), silhouette
 * weight (`sprite.silhouette`, §1.4), and temperament flavor (species
 * flavor text, content/speciesLines.ts) — deliberately NOT personality,
 * which stays orthogonal (a Pebblepip can roll Chaotic and is then a
 * stubborn little rock that is also chaotic).
 */

export type SpeciesId = string;

/**
 * ROUND 2B (content-bible §1.2): added the zero-weight "lineage" tier so
 * evolved forms can only be reached by evolving, never by a fresh hatch.
 * Before this fix, `grovepip` carried `rarity: "uncommon"` and
 * `rollGenome` weights the species roll across the WHOLE registry — so
 * roughly one egg in five hatched a fully-evolved Grovepip, quietly
 * undercutting the evolution feature. `tuning.eggs.rarityWeights.lineage`
 * is 0; `core/pips/genome.test.ts` already pins "weight 0 never hatches".
 * `uncommon`/`rare` stay meaningful as *display* tiers for a future
 * Pipdex — they are not reused as "already evolved" markers.
 */
export type Rarity = "common" | "uncommon" | "rare" | "lineage";

/** Base sprite variant params — consumed by the SpriteResolver (spec §11). */
export interface SpriteVariantParams {
  palettes: readonly string[];
  patterns: readonly string[];
  accessorySlots: number;
  /**
   * Body shape inside the FIXED sprite box (spec §11; content-bible §1.4).
   * Optional — absent means "round", so existing entries (Mosspip,
   * Grovepip) are untouched and their rendering stays byte-identical.
   * Silhouettes vary the shape INSIDE the box; they never exceed it (the
   * box itself — render/spriteResolver.ts's PIP_BODY_WIDTH/HEIGHT — is the
   * tap-hit/selection-ring/shadow contract and is not per-species).
   */
  silhouette?: "round" | "chunky" | "wide" | "tall" | "tiny";
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

/** Every evolution shares the shipped thresholds (spec §4.6; content-bible
 * §1.7: "every base species evolves at the shipped thresholds"). */
const evolutionThresholds = {
  minAgeMs: tuning.evolution.minAgeMs,
  minLifetimeAvgHappiness: tuning.evolution.minLifetimeAvgHappiness,
};

/**
 * Registry order (content-bible §1.2's float-edge caution): `pickSpecies`
 * (core/pips/genome.ts) falls back to `entries[entries.length - 1]` on the
 * ~2⁻⁵³ event that a random draw lands exactly on the weight total — and
 * that fallback ignores weight entirely, so if the LAST entry happened to
 * be a zero-weight "lineage" species, this vanishingly rare float edge
 * would defeat "lineage never hatches". The bible's own prose ("put all
 * seven bases first, then all seven evolved forms") would in fact put a
 * LINEAGE entry last and reintroduce exactly that bug — its stated
 * constraint ("the last entry is a base species, never a lineage one") is
 * the one that matters, so the two lineage/base GROUPS below are ordered
 * lineage-first, base-last to satisfy it while keeping the grouping the
 * prose was going for. Costs nothing; do it anyway.
 */
export const species: Readonly<Record<SpeciesId, SpeciesDef>> = {
  // --- Evolved ("lineage") forms — reachable only by evolving, never by ---
  // --- a fresh hatch (rarity weight 0). No `evolution` field: these are ---
  // --- terminal. Same palette/pattern id lists as their base species ----
  // --- (content-bible §1.3: "a Pip keeps its birth variant ids through ---
  // --- evolution — the renderer reads genome.palette after the species --
  // --- flips"), accessorySlots 2 (vs the base's 1). ---------------------
  grovepip: {
    id: "grovepip",
    name: "Grovepip",
    // The one-field fix (content-bible §1.6): was "uncommon".
    rarity: "lineage",
    sprite: {
      palettes: ["fern", "lichen", "clover"],
      patterns: ["plain", "speckled", "swirl"],
      accessorySlots: 2,
    },
  },
  cairnpip: {
    id: "cairnpip",
    name: "Cairnpip",
    rarity: "lineage",
    sprite: {
      palettes: ["flint", "riverstone", "sandstone"],
      patterns: ["plain", "banded", "speckled"],
      accessorySlots: 2,
      silhouette: "chunky",
    },
  },
  reefpip: {
    id: "reefpip",
    name: "Reefpip",
    rarity: "lineage",
    sprite: {
      palettes: ["cockle", "sandbar", "seafoam"],
      patterns: ["ripple", "speckled", "plain"],
      accessorySlots: 2,
      silhouette: "wide",
    },
  },
  hearthpip: {
    id: "hearthpip",
    name: "Hearthpip",
    rarity: "lineage",
    // Silhouette CHANGES on evolution (tiny → round, content-bible §1.1):
    // "growing up should be legible without being uniform."
    sprite: {
      palettes: ["cinder", "hearthash", "coalglow"],
      patterns: ["ember", "plain", "speckled"],
      accessorySlots: 2,
      silhouette: "round",
    },
  },
  frostpip: {
    id: "frostpip",
    name: "Frostpip",
    rarity: "lineage",
    sprite: {
      palettes: ["powder", "hush", "bluehour"],
      patterns: ["flake", "plain", "banded"],
      accessorySlots: 2,
      silhouette: "round",
    },
  },
  thunderpip: {
    id: "thunderpip",
    name: "Thunderpip",
    rarity: "lineage",
    sprite: {
      palettes: ["nimbus", "dawnwash", "duskveil"],
      patterns: ["puff", "plain", "ripple"],
      accessorySlots: 2,
      silhouette: "tall",
    },
  },
  beaconpip: {
    id: "beaconpip",
    name: "Beaconpip",
    rarity: "lineage",
    // Silhouette CHANGES on evolution (tiny → round, content-bible §1.1),
    // the second of the two lines that do (Emberpip is the first).
    sprite: {
      palettes: ["deepwater", "mossglow", "embercave"],
      patterns: ["glowdot", "plain", "ripple"],
      accessorySlots: 2,
      silhouette: "round",
    },
  },

  // --- Base forms — hatchable, each with exactly one evolved form ------
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
      ...evolutionThresholds,
      giftVariants: {
        berry: "berrybright",
        stew: "heartymoss",
        // ROUND 2B additive edit (content-bible §1.7): new key, existing
        // berry/stew mappings untouched.
        honeydrop: "sunorchard",
      },
      defaultVariantId: "verdant",
    },
  },
  pebblepip: {
    id: "pebblepip",
    name: "Pebblepip",
    rarity: "common",
    sprite: {
      palettes: ["flint", "riverstone", "sandstone"],
      patterns: ["plain", "banded", "speckled"],
      accessorySlots: 1,
      silhouette: "chunky",
    },
    evolution: {
      targetSpeciesId: "cairnpip",
      ...evolutionThresholds,
      giftVariants: {
        toastnut: "mosscap",
        glowcap: "veinlight",
      },
      defaultVariantId: "riverworn",
    },
  },
  tidepip: {
    id: "tidepip",
    name: "Tidepip",
    rarity: "common",
    sprite: {
      palettes: ["cockle", "sandbar", "seafoam"],
      patterns: ["ripple", "speckled", "plain"],
      accessorySlots: 1,
      silhouette: "wide",
    },
    evolution: {
      targetSpeciesId: "reefpip",
      ...evolutionThresholds,
      giftVariants: {
        tideroll: "coralbloom",
        glowcap: "pearlrim",
      },
      defaultVariantId: "seaglass",
    },
  },
  emberpip: {
    id: "emberpip",
    name: "Emberpip",
    rarity: "uncommon",
    sprite: {
      palettes: ["cinder", "hearthash", "coalglow"],
      patterns: ["ember", "plain", "speckled"],
      accessorySlots: 1,
      silhouette: "tiny",
    },
    evolution: {
      targetSpeciesId: "hearthpip",
      ...evolutionThresholds,
      giftVariants: {
        emberloaf: "bakestone",
        cocoabun: "cinnamon",
      },
      defaultVariantId: "hearthlight",
    },
  },
  snowpip: {
    id: "snowpip",
    name: "Snowpip",
    rarity: "uncommon",
    sprite: {
      palettes: ["powder", "hush", "bluehour"],
      patterns: ["flake", "plain", "banded"],
      accessorySlots: 1,
      silhouette: "round",
    },
    evolution: {
      targetSpeciesId: "frostpip",
      ...evolutionThresholds,
      giftVariants: {
        cocoabun: "cocoadust",
        frostberry: "berryfrost",
      },
      defaultVariantId: "windowfrost",
    },
  },
  cloudpip: {
    id: "cloudpip",
    name: "Cloudpip",
    rarity: "uncommon",
    sprite: {
      palettes: ["nimbus", "dawnwash", "duskveil"],
      patterns: ["puff", "plain", "ripple"],
      accessorySlots: 1,
      silhouette: "tall",
    },
    evolution: {
      targetSpeciesId: "thunderpip",
      ...evolutionThresholds,
      giftVariants: {
        honeydrop: "sunshower",
        frostberry: "hailhush",
      },
      defaultVariantId: "rainveil",
    },
  },
  lanternpip: {
    id: "lanternpip",
    name: "Lanternpip",
    rarity: "rare",
    sprite: {
      palettes: ["deepwater", "mossglow", "embercave"],
      patterns: ["glowdot", "plain", "ripple"],
      accessorySlots: 1,
      silhouette: "tiny",
    },
    evolution: {
      targetSpeciesId: "beaconpip",
      ...evolutionThresholds,
      giftVariants: {
        glowcap: "greenflame",
        feastpot: "festival",
      },
      defaultVariantId: "harbourlight",
    },
  },
};
