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
