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
  /**
   * ROUND 2H — THE RISK LINE (docs/lifecycle-bible.md §7.1, shield one:
   * "no hidden risk, ever"). Shown on the send-off card ABOVE the button,
   * always, on every biome — a player who never taps a deep trail must
   * never encounter the ailment system, and a player who does must be
   * told in words before they commit. Exactly one of the two shipped
   * strings, never authored free-form: `content/validate.ts` asserts this
   * string agrees with whether `content/ailments.ts` actually pools an
   * ailment for this biome's id, so the two files cannot drift apart.
   */
  riskCopy: string;
}

/** The two, and only two, risk-line strings (bible §7.1) — shared so the
 * registry and `content/validate.ts`'s consistency check read the exact
 * same literals rather than two hand-typed copies of the same sentence. */
export const SAFE_TRAIL_COPY = "Safe trail.";
export const RISKY_TRAIL_COPY = "Some risk. Pips sometimes come back with a burr.";

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
    riskCopy: SAFE_TRAIL_COPY,
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
    // ROUND 2H: `poultice` (weight 4, bible §3.5 — "drops from all three
    // deep trails") added on top of the ROUND 2B table, which stays
    // otherwise unchanged (still load-bearing for the level-1 wood/fiber
    // ceilings, `content/expeditions.test.ts`). A ~3.5% dilution of the
    // existing weights; verified against `reachability.test.ts` and the
    // ceiling assertions.
    lootTable: [
      { itemId: "fiber", weight: 45 },
      { itemId: "honeydrop", weight: 25 },
      { itemId: "berry", weight: 20 },
      { itemId: "toastnut", weight: 20 },
      { itemId: "poultice", weight: 4 },
    ],
    lootRolls: tuning.expeditions.bramblewick.lootRolls,
    eggChance: tuning.expeditions.bramblewick.eggChance,
    eggSpecies: ["mosspip", "pebblepip"],
    flavor:
      "A hedge with opinions. Twine, honey, and one thorn that will absolutely find you.",
    // Bramblewick can inflict Brambleburr (content/ailments.ts) — the
    // FIRST risky trail a level-1 player can reach, so shield one's full
    // disclosure matters most here.
    riskCopy: RISKY_TRAIL_COPY,
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
    riskCopy: SAFE_TRAIL_COPY,
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
    // ROUND 2H: `poultice` added, same reasoning as Bramblewick's.
    // ROUND 2J (docs/economy-bible.md §1.2) — `lodestone` added at weight
    // 26 (weight sum 104 → 130), paired with `tuning.ts`'s 12 → 15
    // `lootRolls` bump: THE ZERO-DILUTION IDENTITY, `15 × 104 === 12 ×
    // 130`, leaves every OTHER entry's per-trip yield in this table
    // unchanged to the last bit (`content/expeditions.test.ts`). This is
    // the "reveal" tier — the first Keep level a Pip can come home with
    // lodestone, one tier before the Shore turns it into a real faucet.
    lootTable: [
      { itemId: "frostberry", weight: 30 },
      { itemId: "fiber", weight: 25 },
      { itemId: "cocoabun", weight: 20 },
      { itemId: "wood", weight: 15 },
      { itemId: "stew", weight: 10 },
      { itemId: "poultice", weight: 4 },
      { itemId: "lodestone", weight: 26 },
    ],
    lootRolls: tuning.expeditions.snowdrift.lootRolls,
    eggChance: tuning.expeditions.snowdrift.eggChance,
    eggSpecies: ["snowpip", "cloudpip"],
    flavor:
      "Above the treeline everything is quiet, faintly ridiculous, and slightly frozen.",
    // Snowdrift can inflict Chillshake.
    riskCopy: RISKY_TRAIL_COPY,
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
    // ROUND 2J (docs/economy-bible.md §1.2) — `lodestone` added at weight
    // 50 (weight sum 100 → 150), paired with `tuning.ts`'s 6 → 9
    // `lootRolls` bump: THE ZERO-DILUTION IDENTITY, `9 × 100 === 6 × 150`,
    // so `shell/min` stays 0.09000 and `driftwood/min` stays 0.06000 to
    // 5dp — pinned in `content/expeditions.test.ts`. The Shore is the
    // lodestone FAUCET (0.10/min, the highest rate in the game).
    lootTable: [
      { itemId: "shell", weight: 45 },
      { itemId: "driftwood", weight: 30 },
      { itemId: "tideroll", weight: 15 },
      { itemId: "stew", weight: 10 },
      { itemId: "lodestone", weight: 50 },
    ],
    lootRolls: tuning.expeditions.shore.lootRolls,
    eggChance: tuning.expeditions.shore.eggChance,
    eggSpecies: ["tidepip", "cloudpip"],
    flavor: "Salt air, glittering tide pools, and treasures the sea forgot to keep.",
    riskCopy: SAFE_TRAIL_COPY,
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
    // ROUND 2H: `poultice` added, same reasoning as the other two deep
    // trails. Verified against `expeditions.test.ts`'s Feastpot cadence
    // pin (still lands inside its 3–4-trip band after the dilution).
    // ROUND 2J (docs/economy-bible.md §1.2) — `lodestone` added at weight
    // 14 (weight sum 98 → 112), paired with `tuning.ts`'s 14 → 16
    // `lootRolls` bump: THE ZERO-DILUTION IDENTITY, `16 × 98 === 14 ×
    // 112`, so the Feastpot's per-trip chance is unchanged to the last
    // bit — still 1-per-3.5-trips, pinned in `content/expeditions.test.ts`.
    // "The rocks are warm. Nobody knows why." Now they do.
    lootTable: [
      { itemId: "shell", weight: 25 },
      { itemId: "driftwood", weight: 20 },
      { itemId: "glowcap", weight: 20 },
      { itemId: "emberloaf", weight: 15 },
      { itemId: "wood", weight: 12 },
      { itemId: "feastpot", weight: 2 },
      { itemId: "poultice", weight: 4 },
      { itemId: "lodestone", weight: 14 },
    ],
    lootRolls: tuning.expeditions.lanterngrotto.lootRolls,
    eggChance: tuning.expeditions.lanterngrotto.eggChance,
    // Lanternpip lives ONLY here — the trophy chase (bible §3.6).
    eggSpecies: ["emberpip", "lanternpip"],
    flavor:
      "A sea cave that glows on purpose. The rocks are warm. Nobody knows why. Nobody's complaining.",
    // Lanterngrotto can inflict Lanternfever — the riskiest trail (10%).
    riskCopy: RISKY_TRAIL_COPY,
  },
};
