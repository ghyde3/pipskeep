/**
 * Keep level registry (spec §6.3, §9). Costs are resource bundles — no
 * abstract currency exists. Cost values live in tuning.ts.
 */

import type { KeepLevel } from "../core/keep";
import type { ResourceBundle } from "../core/economy";
import { tuning } from "./tuning";

export interface KeepLevelDef {
  level: KeepLevel;
  /** Cost to reach this level from the previous one. Level 1 is free (start). */
  cost: ResourceBundle;
  /** Human-readable unlock notes; systems key off level numbers, not these. */
  unlocks: readonly string[];
}

export const keepLevels: readonly KeepLevelDef[] = [
  {
    level: 1,
    cost: {},
    unlocks: ["Meadow expedition", "8x8 starting plot"],
  },
  {
    level: 2,
    cost: tuning.keepLevelCosts[2],
    unlocks: ["Forest expedition", "+4x8 plot"],
  },
  {
    level: 3,
    cost: tuning.keepLevelCosts[3],
    unlocks: ["Shore expedition", "roster upgrade purchasable"],
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
    // Spec §9: Level 3 makes the roster upgrade purchasable.
    prerequisiteLevel: 3,
  },
};
