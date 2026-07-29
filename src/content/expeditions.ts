/**
 * Expedition registry (spec §6.1). Durations, egg chances, and unlock
 * levels live in tuning.ts; loot tables and flavor live here.
 */

import type { KeepLevel } from "../core/keep";
import { tuning } from "./tuning";

export const EXPEDITION_IDS = ["meadow", "forest", "shore"] as const;
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
  /** Probability [0, 1] that the expedition also returns an egg. */
  eggChance: number;
  flavor: string;
}

export const expeditions: Readonly<Record<ExpeditionId, ExpeditionDef>> = {
  meadow: {
    id: "meadow",
    name: "Meadow",
    unlockKeepLevel: tuning.expeditions.meadow.unlockKeepLevel,
    durationMs: tuning.expeditions.meadow.durationMs,
    lootTable: [
      { itemId: "berry", weight: 60 },
      { itemId: "fiber", weight: 40 },
    ],
    eggChance: tuning.expeditions.meadow.eggChance,
    flavor: "Sun-warmed grass, suspiciously friendly bees, snacks everywhere.",
  },
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
    eggChance: tuning.expeditions.forest.eggChance,
    flavor: "Tall trees, deep shadows, and something delicious simmering somewhere.",
  },
  shore: {
    id: "shore",
    name: "Shore",
    unlockKeepLevel: tuning.expeditions.shore.unlockKeepLevel,
    durationMs: tuning.expeditions.shore.durationMs,
    lootTable: [
      { itemId: "shell", weight: 45 },
      { itemId: "driftwood", weight: 35 },
      { itemId: "stew", weight: 20 },
    ],
    eggChance: tuning.expeditions.shore.eggChance,
    flavor: "Salt air, glittering tide pools, and treasures the sea forgot to keep.",
  },
};
