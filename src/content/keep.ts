/**
 * Keep level registry (spec §6.3, §9). Costs are resource bundles — no
 * abstract currency exists. Cost values live in tuning.ts.
 *
 * ROUND 2F (docs/progression-bible.md §2) — THE 12-TIER LADDER. Every
 * tier has a headline the player can look forward to BY NAME (a tier
 * that only raises a number is a dead tier, so there are none). `level`
 * is gated on TWO keys (`core/state.ts`'s `PURCHASE_KEEP_LEVEL`): Keep XP
 * (`tuning.progression.levelXp`, which paces all twelve) and, for five of
 * them, this registry's `cost` (which keeps the economy load-bearing —
 * see `tuning.progression.levelCosts`'s doc comment for why only five).
 *
 * The comment that used to live here — "a sixth Keep level was
 * considered and declined ... two trips per tier is the stronger shape
 * anyway" — is now stale: this round IS that widening, authorized by the
 * orchestrator once `core/keep`'s `KeepLevel` union could carry it
 * (progression bible §8.1).
 */

import type { KeepLevel } from "../core/keep";
import type { ResourceBundle } from "../core/economy";
import { tuning } from "./tuning";

export interface KeepLevelDef {
  level: KeepLevel;
  /** Cost to reach this level from the previous one. Level 1 is free (start).
   * Six of the eleven non-starting tiers cost nothing (`{}`) — XP alone
   * paces them; see `tuning.progression.levelCosts`'s doc comment. */
  cost: ResourceBundle;
  /**
   * THE ONE PHRASE THE XP BAR SHOWS as "Next: …" (bible §2: "every tier has
   * a headline the player can look forward to BY NAME").
   *
   * A SEPARATE FIELD, not `unlocks[0]`, on purpose. The bar used to read
   * `unlocks[0]`, which made tier 7 advertise itself as `Next: +2 rows of
   * ground` and tier 9 as `Next: +2 columns of ground` — the bar's only job
   * is to name the carrot, and for 2 of 11 tiers it named a NUMBER. Keying
   * the bar to array order also means any future reorder of `unlocks`
   * silently changes what the game promises. So the headline is explicit,
   * required, and validated: it must name a thing, and `keep.test.ts`
   * asserts it never leads with a bare `+N`.
   */
  headline: string;
  /** Human-readable unlock notes; systems key off level numbers, not these.
   * The full list, shown by the upgrade card's road-ahead. */
  unlocks: readonly string[];
}

/** `progression.levelCosts[N] ?? {}` — the SINGLE source of truth for
 * every tier's resource cost (progression bible §8.6 risk 1's mandatory
 * mitigation: the shipped `tuning.keepLevelCosts` is deleted, so there is
 * no second file for these two numbers to drift from). */
function costFor(level: number): ResourceBundle {
  return tuning.progression.levelCosts[level] ?? {};
}

export const keepLevels: readonly KeepLevelDef[] = [
  {
    level: 1,
    cost: {},
    headline: "The Meadow and the Bramblewick",
    unlocks: [
      "Meadow expedition",
      "Bramblewick expedition",
      "8x8 starting plot",
      "Food Bowl, Bed, Gathering Station",
      "Keep Comfort is live from tap one",
      "the Keepsake Shelf",
    ],
  },
  {
    level: 2,
    cost: costFor(2),
    headline: "The Forest trail",
    unlocks: ["Forest expedition", "+4x8 plot", "the Wash Basin", "the Play Post"],
  },
  {
    level: 3,
    cost: costFor(3),
    headline: "The Snowdrift, and set bonuses",
    unlocks: [
      "Snowdrift expedition",
      "the Stockpot",
      "the Simmering job",
      "set bonuses go live (3-of-a-set)",
    ],
  },
  {
    level: 4,
    cost: costFor(4),
    headline: "The Shore, and Cozy Bunks",
    // ROUND 2J (docs/economy-bible.md §3.1/§6.3) — the Craft Table lands
    // one tier before the Lanterngrotto, so the Build sheet's own
    // road-ahead names the answer to "my Pip came home ill" before the
    // riskiest trail opens. Named here, not just left to the Build sheet's
    // generic "hosts a job" card copy, because this is the one surface the
    // bible's visibility table calls out by file (§6.3: "tier 4's `unlocks`
    // list in `content/keep.ts`").
    unlocks: [
      "Shore expedition",
      "Cozy Bunks becomes purchasable (roster 3 → 5)",
      "the Craft Table — a Pip can craft what the Keep needs, including a cure",
    ],
  },
  {
    level: 5,
    cost: costFor(5),
    headline: "The Lanterngrotto",
    // ROUND 2H (docs/lifecycle-bible.md §3.5): the Poultice Shelf lands on
    // the same tier as the riskiest trail, so the answer to "what if" is
    // on the Build sheet the same tier the question first gets sharp.
    unlocks: ["Lanterngrotto expedition", "+2 columns of ground", "the Poultice Shelf"],
  },
  {
    level: 6,
    cost: costFor(6),
    headline: "The Larder and the Nest Warmer",
    unlocks: [
      "the Larder",
      "the Nest Warmer",
      "eggs hatch sooner",
      "5-of-a-set bonuses go live",
    ],
  },
  {
    level: 7,
    cost: costFor(7),
    headline: "The Trail Post, and more ground",
    unlocks: ["the Trail Post — trips find more", "+2 rows of ground"],
  },
  {
    level: 8,
    cost: costFor(8),
    headline: "The Workbench and the Mending job",
    unlocks: ["the Workbench", "the Mending job", "the Sun Bunks"],
  },
  {
    level: 9,
    cost: costFor(9),
    headline: "The Chronicle, and the last ground",
    unlocks: ["the Chronicle — a dated page of everything the Keep has done", "+2 columns of ground"],
  },
  {
    level: 10,
    cost: costFor(10),
    headline: "The Beacon — every trip comes home sooner",
    unlocks: ["the Beacon — every trip comes home sooner"],
  },
  {
    level: 11,
    cost: costFor(11),
    headline: "A sixth bed — the roster cap rises to 6",
    unlocks: ["a sixth bed — the roster cap rises to 6"],
  },
  {
    level: 12,
    cost: costFor(12),
    headline: "The Weathervane, and Renown begins",
    unlocks: ["the Weathervane", "Renown begins"],
  },
];

/**
 * Keep upgrade effects (spec §3 "Keep upgrades" registry). `rosterCap`
 * raises the roster cap (spec §7.4); `attraction` is the spec §12 seam
 * for the deferred Attraction buildings — a supported no-op effect id,
 * nothing more.
 */
export type KeepUpgradeEffect = "rosterCap" | "attraction";

export interface KeepUpgradeDef {
  id: string;
  name: string;
  cost: ResourceBundle;
  effect: KeepUpgradeEffect;
  /** Purchasable once the Keep reaches this level (spec §9). */
  prerequisiteLevel: KeepLevel;
}

export const ROSTER_UPGRADE_ID = "roster-upgrade";

export const keepUpgrades: Readonly<Record<string, KeepUpgradeDef>> = {
  [ROSTER_UPGRADE_ID]: {
    id: ROSTER_UPGRADE_ID,
    name: "Cozy Bunks",
    cost: tuning.rosterUpgradeCost,
    effect: "rosterCap",
    // ROUND 2F (progression bible §2.1): 3 → 4, following the Shore
    // (which now unlocks at tier 4) — the trail that actually supplies
    // this cost's Shell/Driftwood.
    prerequisiteLevel: 4,
  },
};
