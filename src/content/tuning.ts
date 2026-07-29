/**
 * ALL `[DEFAULT — review]` numeric values from spec §4–§7 live here
 * (spec §14: balancing is a single-file pass). Registries import from this
 * file rather than repeating numbers.
 *
 * Every value in this file is `[DEFAULT — review]` unless noted otherwise.
 */

import type { NeedId } from "../core/pips";
import type { PersonalityId } from "./personalities";
import type { KeepLevel } from "../core/keep";
import type { ResourceBundle } from "../core/economy";
// Type-only import from a sibling registry (erased at compile — no cycle).
import type { Rarity } from "./species";

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;

export const tuning = {
  /** Base need decay per real-time hour (spec §4.1). Negative = decays. */
  needDecayPerHour: {
    hunger: -6,
    cleanliness: -4,
    happiness: -5,
    energy: -3, // while awake; Resting regenerates instead (see care.rest)
  } satisfies Record<NeedId, number>,

  /**
   * Personality decay multipliers (spec §4.2). Effective rate =
   * base × personality × life-stage × situational, all multiplicative.
   */
  personalityDecayMultipliers: {
    lazy: { hunger: 0.8, cleanliness: 1.0, happiness: 1.0, energy: 1.4 },
    curious: { hunger: 1.0, cleanliness: 1.2, happiness: 0.8, energy: 1.1 },
    hardworking: { hunger: 1.2, cleanliness: 1.0, happiness: 1.1, energy: 1.2 },
    chaotic: { hunger: 1.1, cleanliness: 1.5, happiness: 0.7, energy: 1.0 },
    clingy: { hunger: 1.0, cleanliness: 1.0, happiness: 1.3, energy: 0.9 },
  } satisfies Record<PersonalityId, Record<NeedId, number>>,

  /** Personality quirk numbers (spec §4.2 table, right column). */
  quirks: {
    /** Clingy: Happiness decay ×2.0 while OnExpedition (situational modifier). */
    clingyExpeditionHappinessMultiplier: 2.0,
    /** Curious: +10% expedition loot. */
    curiousLootBonus: 0.1,
    /** Hardworking: −15% expedition duration. */
    hardworkingExpeditionDurationMultiplier: 0.85,
    /** Chaotic: 10% chance to DISPLAY a mood one step off from actual (§4.3). */
    chaoticMoodDisplayOffsetChance: 0.1,
  },

  /**
   * Mood thresholds (spec §4.3). Evaluate in order, first match wins:
   * Miserable → Grumpy → Beaming → Content.
   */
  mood: {
    /** Miserable — any need < this. */
    miserableBelow: 15,
    /** Grumpy — any need < this. */
    grumpyBelow: 40,
    /** Beaming — all needs ≥ this. */
    beamingAtOrAbove: 70,
  },

  /** Sulking exit: ALL four needs ≥ this (inclusive) → back to Idle (§4.4). */
  sulkExitThreshold: 25,

  /**
   * Offline catch-up rate cap (spec §4.5): needs change and Gathering
   * production accrue only during the FIRST this-many ms of absence.
   * Rates are capped; timers (expeditions, eggs) are not.
   */
  offlineRateCapMs: 12 * HOUR_MS,

  /** Care action effects and cooldowns (spec §5). */
  care: {
    clean: {
      /** Cleanliness → 100, deliberately trivial (a check-in ritual). */
      setsCleanlinessTo: 100,
      cooldownMs: 60 * SECOND_MS,
    },
    play: {
      happiness: 20,
      energy: -10,
    },
    pet: {
      happiness: 8,
      /** Clingy gets this instead of the base +8. */
      clingyHappiness: 14,
      cooldownMs: 30 * SECOND_MS,
    },
    rest: {
      /** Energy regen per hour while Resting (spec §4.1). */
      energyPerHour: 15,
      /** Pip auto-wakes when Energy reaches this. */
      autoWakeAtEnergy: 100,
    },
  },

  /** Play refusal thresholds (spec §5). Refusals are free and cooldown-less. */
  playRefusal: {
    /** Any Pip refuses Play below this Energy. */
    minEnergy: 10,
    /** Lazy Pips additionally refuse below this Energy. */
    lazyMinEnergy: 30,
    /** Lazy Pips refuse any other Play this often, just because. */
    lazyFlavorRefusalChance: 0.15,
  },

  /**
   * Expedition table (spec §6.1). Loot tables live in expeditions.ts.
   * `lootRolls` = base weighted rolls per completed trip (the reveal's
   * item count before Curious's bonus rolls).
   */
  expeditions: {
    meadow: {
      durationMs: 5 * MINUTE_MS,
      eggChance: 0.08,
      unlockKeepLevel: 1,
      lootRolls: 2,
    },
    forest: {
      durationMs: 15 * MINUTE_MS,
      eggChance: 0.12,
      unlockKeepLevel: 2,
      lootRolls: 3,
    },
    shore: {
      durationMs: 30 * MINUTE_MS,
      eggChance: 0.18,
      unlockKeepLevel: 3,
      lootRolls: 4,
    },
  } satisfies Record<
    string,
    {
      durationMs: number;
      eggChance: number;
      unlockKeepLevel: KeepLevel;
      lootRolls: number;
    }
  >,

  /** Gathering job (spec §6.2): 1 resource per interval from a weighted table. */
  gathering: {
    intervalMs: 10 * MINUTE_MS,
    table: { berry: 0.7, fiber: 0.3 },
  },

  /** Eggs (spec §7). Incubation timers are never capped by offline rules. */
  eggs: {
    /** Incubation (spec §7.2): real-time, 2h default. */
    incubationMsDefault: 2 * HOUR_MS,
    /** Content-defined per-rarity overrides (spec §7.2); absent → default. */
    incubationMsByRarity: {} satisfies Partial<Record<Rarity, number>>,
    /** Rarity of eggs found on expeditions (spec §7.1 — the MVP source). */
    expeditionEggRarity: "common" satisfies Rarity,
    /**
     * Species-roll weights by registry rarity at hatch (spec §7.3:
     * "weighted by registry rarity"). Relative weights per species entry.
     */
    rarityWeights: {
      common: 100,
      uncommon: 25,
      rare: 5,
    } satisfies Record<Rarity, number>,
  },

  /** Fresh-genome extras rolled at hatch (core/pips/genome rollGenome). */
  genome: {
    /** Chance a hatched genome is the rare iridescent variant — rare
     * enough to feel special, common enough to actually meet one. */
    shinyChance: 0.025,
  },

  /**
   * Breeding seam numbers (spec §7.3/§12 — `combineGenomes` only; nothing
   * in gameplay reads these until the breeding UI phase).
   */
  breeding: {
    /** Chance that an inherited palette/pattern mutates to a random
     * variant of the child's species instead (per field). */
    mutationChance: 0.05,
  },

  /** Roster cap (spec §7.4): 3 active Pips; Keep upgrade raises to 5. */
  rosterCap: 3,
  rosterCapUpgraded: 5,

  /** Pipling life stage (spec §4.6): hatch → 24h; needs decay ×1.2. */
  pipling: {
    durationMs: 24 * HOUR_MS,
    decayMultiplier: 1.2,
  },

  /**
   * Evolution (spec §4.6): ready when ageMs ≥ 72h AND lifetime average
   * Happiness (happinessIntegral / ageMs) ≥ 70. Player-witnessed via tap.
   */
  evolution: {
    minAgeMs: 72 * HOUR_MS,
    minLifetimeAvgHappiness: 70,
  },

  /** Keep level costs (spec §6.3); referenced by content/keep.ts. */
  keepLevelCosts: {
    2: { wood: 15, fiber: 10 },
    3: { wood: 20, shell: 12, driftwood: 6 },
  } satisfies Partial<Record<KeepLevel, ResourceBundle>>,

  /**
   * Keep grid (spec §9): 8×8 starting area; Level 2 adds a +4×8 plot,
   * expressed as simple rows/cols growth per level (cumulative). Bounds
   * math lives in core/keep `gridBounds`.
   */
  keepGrid: {
    cols: 8,
    rows: 8,
    /** Extra cols/rows unlocked AT each Keep level (spec §9: L2 = +4×8,
     * i.e. 4 more rows at the same 8-column width). */
    growthPerLevel: {
      2: { cols: 0, rows: 4 },
    } satisfies Partial<Record<KeepLevel, { cols: number; rows: number }>>,
  },

  /** Roster upgrade cost (spec §7.4: Keep upgrade raises the cap 3 → 5;
   * purchasable at Keep level 3). Referenced by content/keep.ts. */
  rosterUpgradeCost: { wood: 10, shell: 8, driftwood: 4 } satisfies ResourceBundle,

  /** Food effects (spec §5/§6.3); referenced by content/foods.ts. */
  foods: {
    berry: { hunger: 25 },
    stew: { hunger: 50, happiness: 5 },
  },

  /** New saves are seeded with 3 Berries so the guided first Feed works
   * (§6.3). Item counts, not a cost bundle — Berries are food (inventory),
   * not a resource, so ResourceBundle deliberately does not apply here. */
  startingInventory: { berry: 3 } satisfies Readonly<Record<string, number>>,
} as const;

export type Tuning = typeof tuning;
