/**
 * Expedition registry (spec §6.1). Durations, egg chances, and unlock
 * levels live in tuning.ts; loot tables, flavor text, and the per-biome
 * egg pools live here.
 *
 * ROUND 2B — SIX BIOMES, THREE TIERS, TWO RHYTHMS (content bible §2). Each
 * Keep level now unlocks a PAIR of trails:
 *
 *   - a QUICK trip (Meadow 5m / Forest 15m / Shore 30m) — the active-play
 *     loop. Best items per minute, best eggs per HOUR.
 *   - a DEEP trip (Bramblewick 40m / Snowdrift 60m / Lanterngrotto 90m) —
 *     the idle loop. One per absence, richer foods, a higher per-trip egg
 *     chance, and — via `eggSpecies` below — the ONLY source of its
 *     species.
 *
 * Deep trips never win on raw throughput (see tuning.ts's income-rate
 * comment on `expeditions`); they earn their slot by being the only door
 * to their biome's foods and species. Duration/eggChance/lootRolls/unlock
 * numbers live in tuning.ts (spec §14: one file for balancing); loot
 * tables and flavor are authored here because they are not single scalars.
 */

import type { KeepLevel } from "../core/keep";
// Type-only import from a sibling registry (erased at compile — no cycle,
// same pattern tuning.ts uses for `Rarity`).
import type { SpeciesId } from "./species";
import { tuning } from "./tuning";

export const EXPEDITION_IDS = [
  "meadow",
  "bramblewick",
  "forest",
  "snowdrift",
  "shore",
  "lanterngrotto",
] as const;
export type ExpeditionId = (typeof EXPEDITION_IDS)[number];

export interface LootTableEntry {
  /**
   * A resource id or food id. Typed as string so validation (not the
   * compiler) is the source of truth for "does this item exist" — content
   * must stay editable without touching types.
   */
  itemId: string;
  /** Relative weight, > 0. */
  weight: number;
}

export interface ExpeditionDef {
  id: ExpeditionId;
  name: string;
  /** Available once the Keep reaches this level (spec §9). */
  unlockKeepLevel: KeepLevel;
  durationMs: number;
  /** Weighted loot table; rolls use the seeded expedition stream (§6.1). */
  lootTable: readonly LootTableEntry[];
  /** Base weighted rolls per completed trip (items in the reveal). */
  lootRolls: number;
  /** Probability [0, 1] that the expedition also returns an egg. */
  eggChance: number;
  /**
   * ROUND 2B — the collection engine (content bible §3.6). Species ids
   * this biome's eggs may hatch, weighted by registry rarity WITHIN the
   * pool (no new weighting concept). Absent = the whole registry, weighted
   * by rarity — today's default hatch behaviour (spec §7.3).
   *
   * This is content-only: `core/state.ts`'s `HATCH_EGG` must additionally
   * read `egg.sourceExpeditionId` and look up this field to make biomes
   * actually hatch their own pool (bible §8.1.1 — a §3-approved, separately
   * tracked core change with an exact RNG-cursor-preserving patch). Until
   * that lands, this field is validated but inert: every egg still rolls
   * the whole registry. Shipping it now means the patch is a two-line
   * read, not a design exercise.
   */
  eggSpecies?: readonly SpeciesId[];
  /** Seasonal-events seam (spec §12): optional availability window.
   * NOTHING consumes this yet — registries accept it so seasonal content
   * later is a data change, not a schema change. */
  availableWindow?: { from: string; to: string };
  flavor: string;
}

export const expeditions: Readonly<Record<ExpeditionId, ExpeditionDef>> = {
  meadow: {
    id: "meadow",
    name: "Meadow",
    unlockKeepLevel: tuning.expeditions.meadow.unlockKeepLevel,
    durationMs: tuning.expeditions.meadow.durationMs,
    // ROUND 2A: Wood ("fallen twigs") added. Wood previously dropped ONLY
    // in the Forest, which unlocks at Keep level 2, which itself cost
    // Wood — the game could not progress past level 1. Kept deliberately
    // modest: the Forest still yields more than twice as much Wood per
    // trip, so unlocking it still reads as the upgrade it is. Guarded by
    // core/economy/reachability.test.ts.
    //
    // ROUND 2B: table UNCHANGED on purpose (bible §2.2) — load-bearing for
    // four pinned assertions (the 30–45 min level-2 target, the
    // Gathering-Station on-ramp ratio, the Forest-beats-Meadow-on-wood
    // pair, and the daily-berry ritual).
    lootTable: [
      { itemId: "berry", weight: 40 },
      { itemId: "fiber", weight: 35 },
      { itemId: "wood", weight: 25 },
    ],
    lootRolls: tuning.expeditions.meadow.lootRolls,
    eggChance: tuning.expeditions.meadow.eggChance,
    // Mosspip everywhere (the starter species); Cloudpip also drifts
    // through here (it is a Meadow/Snowdrift dual-home line, bible §1.1).
    eggSpecies: ["mosspip", "cloudpip"],
    flavor:
      "Sun-warmed grass, suspiciously friendly bees, snacks and fallen twigs everywhere.",
  },
  /**
   * ROUND 2B — the level-1 DEEP trip (bible §2.1). 40 minutes is the
   * shortest thing that reads as "leave it running while you do something
   * else", short enough that a first session can still see one come home.
   * Drops NO wood by design (see tuning.ts's level-1 wood-ceiling note),
   * so it changes nothing about how long Keep level 2 takes — it only
   * makes the waiting richer: fiber, the Honeydrop treat, and the
   * Toastnut.
   */
  bramblewick: {
    id: "bramblewick",
    name: "Bramblewick",
    unlockKeepLevel: tuning.expeditions.bramblewick.unlockKeepLevel,
    durationMs: tuning.expeditions.bramblewick.durationMs,
    lootTable: [
      { itemId: "fiber", weight: 45 },
      { itemId: "honeydrop", weight: 25 },
      { itemId: "berry", weight: 20 },
      { itemId: "toastnut", weight: 20 },
    ],
    lootRolls: tuning.expeditions.bramblewick.lootRolls,
    eggChance: tuning.expeditions.bramblewick.eggChance,
    eggSpecies: ["mosspip", "pebblepip"],
    flavor:
      "A hedge with opinions. Twine, honey, and one thorn that will absolutely find you.",
  },
  /**
   * ROUND 2A: Forest 4 → 6 rolls. At 4 rolls the Forest paid 0.12 Wood
   * per minute against the Meadow's 0.15 — so the newly unlocked
   * expedition was a Wood DOWNGRADE, and the fastest route to the
   * level-3 Wood cost it gates was to ignore it and keep spamming the
   * Meadow. An unlock the optimal player declines is not an unlock. At
   * 6 rolls it pays 0.18 Wood/minute (+20% on the Meadow) and lands a
   * six-item haul, which is what a fifteen-minute wait should look
   * like. Short trips still win on RAW items per minute (Meadow 0.60 vs
   * Forest 0.40) — active play beating idle play is the intended
   * shape; the tier below just no longer wins at the tier above's own
   * headline resource. Guarded by `core/economy/reachability.test.ts`.
   *
   * ROUND 2B: table UNCHANGED (bible §2.2 — load-bearing, same reasons as
   * the Meadow). Only `eggSpecies` is new.
   */
  forest: {
    id: "forest",
    name: "Forest",
    unlockKeepLevel: tuning.expeditions.forest.unlockKeepLevel,
    durationMs: tuning.expeditions.forest.durationMs,
    lootTable: [
      { itemId: "wood", weight: 45 },
      { itemId: "berry", weight: 30 },
      { itemId: "fiber", weight: 15 },
      { itemId: "stew", weight: 10 },
    ],
    lootRolls: tuning.expeditions.forest.lootRolls,
    eggChance: tuning.expeditions.forest.eggChance,
    eggSpecies: ["mosspip", "pebblepip", "emberpip"],
    flavor: "Tall trees, deep shadows, and something delicious simmering somewhere.",
  },
  /**
   * ROUND 2B — the level-2 DEEP trip. An hour, sized so an overnight
   * player gets exactly one completed run. Thin pickings and fat egg
   * odds: above the treeline there is not much to carry home, but it is
   * the only place a Snowpip has ever been seen.
   */
  snowdrift: {
    id: "snowdrift",
    name: "Snowdrift",
    unlockKeepLevel: tuning.expeditions.snowdrift.unlockKeepLevel,
    durationMs: tuning.expeditions.snowdrift.durationMs,
    lootTable: [
      { itemId: "frostberry", weight: 30 },
      { itemId: "fiber", weight: 25 },
      { itemId: "cocoabun", weight: 20 },
      { itemId: "wood", weight: 15 },
      { itemId: "stew", weight: 10 },
    ],
    lootRolls: tuning.expeditions.snowdrift.lootRolls,
    eggChance: tuning.expeditions.snowdrift.eggChance,
    eggSpecies: ["snowpip", "cloudpip"],
    flavor:
      "Above the treeline everything is quiet, faintly ridiculous, and slightly frozen.",
  },
  shore: {
    id: "shore",
    name: "Shore",
    unlockKeepLevel: tuning.expeditions.shore.unlockKeepLevel,
    durationMs: tuning.expeditions.shore.durationMs,
    // ROUND 2B (bible §2.2 — the one loot-table edit this round): traded
    // `stew 20` for `stew 10 + tideroll 15` and `driftwood 35 → 30`, to
    // give the Shore a signature food. Verified safe: shell/minute is
    // UNCHANGED at 0.090; driftwood/minute falls 0.070 → 0.060; the
    // roster upgrade still clears its 3h affordability check with a 4×
    // margin (bible §3.2). Guarded by `core/economy/reachability.test.ts`.
    lootTable: [
      { itemId: "shell", weight: 45 },
      { itemId: "driftwood", weight: 30 },
      { itemId: "tideroll", weight: 15 },
      { itemId: "stew", weight: 10 },
    ],
    lootRolls: tuning.expeditions.shore.lootRolls,
    eggChance: tuning.expeditions.shore.eggChance,
    eggSpecies: ["tidepip", "cloudpip"],
    flavor: "Salt air, glittering tide pools, and treasures the sea forgot to keep.",
  },
  /**
   * ROUND 2B — the level-3 DEEP trip, and the top of the ladder. 90
   * minutes, the richest food table in the game (the only source of the
   * Emberloaf and the Feastpot), and a coin-flip egg chance on the only
   * pool a Lanternpip appears in. Still not a throughput win: 14 rolls
   * over 90 minutes is 0.156 items/min against the Meadow's 0.60. You go
   * for what only it has.
   */
  lanterngrotto: {
    id: "lanterngrotto",
    name: "Lanterngrotto",
    unlockKeepLevel: tuning.expeditions.lanterngrotto.unlockKeepLevel,
    durationMs: tuning.expeditions.lanterngrotto.durationMs,
    lootTable: [
      { itemId: "shell", weight: 25 },
      { itemId: "driftwood", weight: 20 },
      { itemId: "glowcap", weight: 20 },
      { itemId: "emberloaf", weight: 15 },
      { itemId: "wood", weight: 12 },
      { itemId: "feastpot", weight: 2 },
    ],
    lootRolls: tuning.expeditions.lanterngrotto.lootRolls,
    eggChance: tuning.expeditions.lanterngrotto.eggChance,
    // Lanternpip lives ONLY here — the trophy chase (bible §3.6).
    eggSpecies: ["emberpip", "lanternpip"],
    flavor:
      "A sea cave that glows on purpose. The rocks are warm. Nobody knows why. Nobody's complaining.",
  },
};
